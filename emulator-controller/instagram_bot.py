from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.common.appiumby import AppiumBy
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait


logger = logging.getLogger(__name__)


class ActionFailedException(Exception):
    pass


class RateLimitException(ActionFailedException):
    pass


class BannedAccountException(ActionFailedException):
    pass


class CaptchaException(ActionFailedException):
    pass


class InstagramBot:
    def __init__(
        self,
        *,
        appium_server_url: str,
        device_serial: str,
        app_package: str,
        app_activity: str,
        min_human_delay: float,
        max_human_delay: float,
    ) -> None:
        self.appium_server_url = appium_server_url
        self.device_serial = device_serial
        self.app_package = app_package
        self.app_activity = app_activity
        self.min_human_delay = min_human_delay
        self.max_human_delay = max_human_delay
        self.driver: webdriver.Remote | None = None

    # -------------------------
    # Session
    # -------------------------
    async def connect(self) -> None:
        options = UiAutomator2Options()
        options.platform_name = "Android"
        options.device_name = self.device_serial
        options.udid = self.device_serial
        options.app_package = self.app_package
        options.app_activity = self.app_activity
        options.no_reset = True
        options.new_command_timeout = 180
        options.automation_name = "UiAutomator2"

        self.driver = await asyncio.to_thread(
            webdriver.Remote,
            command_executor=self.appium_server_url,
            options=options,
        )
        logger.info("Appium session started for %s", self.device_serial)

    async def close(self) -> None:
        if self.driver is not None:
            await asyncio.to_thread(self.driver.quit)
            self.driver = None
            logger.info("Appium session closed for %s", self.device_serial)

    # -------------------------
    # Public actions
    # -------------------------
    async def publish_post(self, image_path: str, caption: str) -> dict[str, Any]:
        start = time.perf_counter()
        try:
            self._ensure_driver()
            await self._random_scroll()
            await self._tap_any(
                [
                    (AppiumBy.ACCESSIBILITY_ID, "New post"),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().descriptionContains("Create")'),
                    (AppiumBy.ID, "com.instagram.android:id/creation_tab"),
                ],
                "new post button",
            )
            await self._human_delay(0.7, 2.0)

            await self._tap_any(
                [
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().textContains("Gallery")'),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().descriptionContains("Gallery")'),
                ],
                "gallery selector",
            )
            await self._human_delay(0.5, 1.5)

            # Try selecting first media thumb or by provided filename.
            file_name = image_path.split("/")[-1].split("\\")[-1]
            selected = await self._try_tap_any(
                [
                    (AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().descriptionContains("{file_name}")'),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().resourceIdMatches(".*media_thumbnail.*")'),
                    (AppiumBy.XPATH, "(//android.widget.ImageView)[1]"),
                ]
            )
            if not selected:
                raise ActionFailedException("Unable to select gallery image")
            await self._human_delay(0.5, 2.0)

            # Next button twice (media crop then filter)
            await self._tap_text_button("Next")
            await self._human_delay(0.6, 1.8)
            await self._tap_text_button("Next")
            await self._human_delay(0.6, 1.8)

            caption_field = await self._find_any(
                [
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().textContains("Write a caption")'),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().resourceIdMatches(".*caption_text_view.*")'),
                    (AppiumBy.CLASS_NAME, "android.widget.EditText"),
                ],
                timeout=15,
            )
            await asyncio.to_thread(caption_field.click)
            await self._human_type(caption)

            await self._tap_text_button("Share")
            await self._human_delay(2.0, 5.0)

            await self._detect_common_blocks()

            elapsed = time.perf_counter() - start
            return {"success": True, "action": "post", "duration_seconds": round(elapsed, 2)}
        except Exception as exc:
            await self._screenshot_failure("publish_post")
            raise self._map_exception(exc) from exc

    async def like_post(self, post_url: str) -> dict[str, Any]:
        try:
            self._ensure_driver()
            await self._human_delay(1.5, 4.0)
            await self._open_url(post_url)
            await self._random_scroll()

            liked = await self._try_tap_any(
                [
                    (AppiumBy.ACCESSIBILITY_ID, "Like"),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().descriptionContains("Like")'),
                    (AppiumBy.ID, "com.instagram.android:id/row_feed_button_like"),
                ]
            )
            if not liked:
                # fallback double tap
                await self._double_tap_center()

            await self._human_delay(1.5, 4.0)
            await self._detect_common_blocks()
            return {"success": True, "action": "like", "post_url": post_url}
        except Exception as exc:
            await self._screenshot_failure("like_post")
            raise self._map_exception(exc) from exc

    async def follow_user(self, username: str) -> dict[str, Any]:
        try:
            self._ensure_driver()
            await self._open_url(f"https://www.instagram.com/{username}/")
            await self._human_delay(2.0, 5.0)
            await self._random_scroll()

            clicked = await self._try_tap_any(
                [
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().text("Follow")'),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().text("Follow back")'),
                    (AppiumBy.ACCESSIBILITY_ID, "Follow"),
                    (AppiumBy.ACCESSIBILITY_ID, "Follow back"),
                ]
            )
            if not clicked:
                raise ActionFailedException(f"Follow button not found for {username}")

            await self._human_delay(2.0, 5.0)
            await self._detect_common_blocks()
            return {"success": True, "action": "follow", "username": username}
        except Exception as exc:
            await self._screenshot_failure("follow_user")
            raise self._map_exception(exc) from exc

    async def comment_on_post(self, post_url: str, comment_text: str) -> dict[str, Any]:
        try:
            self._ensure_driver()
            await self._open_url(post_url)
            await self._human_delay(1.0, 2.5)
            await self._random_scroll()

            await self._tap_any(
                [
                    (AppiumBy.ACCESSIBILITY_ID, "Comment"),
                    (AppiumBy.ID, "com.instagram.android:id/row_feed_button_comment"),
                ],
                "comment icon",
            )
            await self._human_delay(0.5, 1.5)

            field = await self._find_any(
                [
                    (AppiumBy.CLASS_NAME, "android.widget.EditText"),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().textContains("Add a comment")'),
                ],
                timeout=10,
            )
            await asyncio.to_thread(field.click)
            await self._human_type(comment_text)

            sent = await self._try_tap_any(
                [
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().text("Post")'),
                    (AppiumBy.ACCESSIBILITY_ID, "Post"),
                ]
            )
            if not sent:
                raise ActionFailedException("Comment submit button not found")

            await self._human_delay(1.0, 3.0)
            await self._detect_common_blocks()
            return {"success": True, "action": "comment", "post_url": post_url}
        except Exception as exc:
            await self._screenshot_failure("comment_on_post")
            raise self._map_exception(exc) from exc

    async def check_notifications(self) -> list[dict[str, str]]:
        try:
            self._ensure_driver()
            await self._tap_any(
                [
                    (AppiumBy.ACCESSIBILITY_ID, "Activity"),
                    (AppiumBy.ACCESSIBILITY_ID, "Notifications"),
                    (AppiumBy.ANDROID_UIAUTOMATOR, 'new UiSelector().descriptionContains("Activity")'),
                ],
                "notifications tab",
            )
            await self._human_delay(1.0, 2.5)

            items = await asyncio.to_thread(
                self.driver.find_elements,  # type: ignore[union-attr]
                AppiumBy.CLASS_NAME,
                "android.widget.TextView",
            )
            parsed = []
            for item in items[:20]:
                text = (item.text or "").strip()
                if text:
                    parsed.append({"text": text})
            return parsed
        except Exception as exc:
            await self._screenshot_failure("check_notifications")
            raise self._map_exception(exc) from exc

    # -------------------------
    # Helpers
    # -------------------------
    def _ensure_driver(self) -> None:
        if self.driver is None:
            raise ActionFailedException("Appium driver is not connected")

    async def _open_url(self, url: str) -> None:
        self._ensure_driver()
        await asyncio.to_thread(self.driver.get, url)  # type: ignore[union-attr]
        await self._human_delay(0.8, 2.2)

    async def _tap_text_button(self, text: str) -> None:
        await self._tap_any(
            [
                (AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().text("{text}")'),
                (AppiumBy.ACCESSIBILITY_ID, text),
            ],
            f"button:{text}",
        )

    async def _tap_any(self, selectors: list[tuple[str, str]], label: str) -> None:
        el = await self._find_any(selectors, timeout=10)
        await asyncio.to_thread(el.click)
        await self._human_delay()
        logger.info("Tapped %s on %s", label, self.device_serial)

    async def _try_tap_any(self, selectors: list[tuple[str, str]]) -> bool:
        try:
            el = await self._find_any(selectors, timeout=4)
            await asyncio.to_thread(el.click)
            await self._human_delay()
            return True
        except Exception:
            return False

    async def _find_any(self, selectors: list[tuple[str, str]], timeout: int = 8):
        self._ensure_driver()
        end = time.time() + timeout
        last_error: Exception | None = None
        while time.time() < end:
            for by, value in selectors:
                try:
                    def _lookup():
                        wait = WebDriverWait(self.driver, 1)  # type: ignore[arg-type]
                        return wait.until(lambda d: d.find_element(by, value))
                    return await asyncio.to_thread(_lookup)
                except Exception as exc:
                    last_error = exc
            await asyncio.sleep(0.25)
        raise TimeoutException(f"No selector matched: {selectors}") from last_error

    async def _human_type(self, text: str) -> None:
        self._ensure_driver()
        active = await asyncio.to_thread(self.driver.switch_to.active_element)  # type: ignore[union-attr]
        for ch in text:
            await asyncio.to_thread(active.send_keys, ch)
            await asyncio.sleep(random.uniform(0.03, 0.18))
        await self._human_delay(0.4, 1.2)

    async def _double_tap_center(self) -> None:
        self._ensure_driver()
        size = await asyncio.to_thread(lambda: self.driver.get_window_size())  # type: ignore[union-attr]
        x = int(size["width"] * 0.5)
        y = int(size["height"] * 0.5)
        # Two quick taps via mobile command
        await asyncio.to_thread(self.driver.execute_script, "mobile: clickGesture", {"x": x, "y": y})  # type: ignore[union-attr]
        await asyncio.sleep(0.12)
        await asyncio.to_thread(self.driver.execute_script, "mobile: clickGesture", {"x": x, "y": y})  # type: ignore[union-attr]

    async def _random_scroll(self) -> None:
        self._ensure_driver()
        if random.random() < 0.35:
            size = await asyncio.to_thread(lambda: self.driver.get_window_size())  # type: ignore[union-attr]
            x = int(size["width"] * random.uniform(0.3, 0.7))
            start_y = int(size["height"] * random.uniform(0.7, 0.85))
            end_y = int(size["height"] * random.uniform(0.25, 0.45))
            await asyncio.to_thread(
                self.driver.execute_script,  # type: ignore[union-attr]
                "mobile: swipeGesture",
                {
                    "left": x - 10,
                    "top": end_y,
                    "width": 20,
                    "height": start_y - end_y,
                    "direction": "up",
                    "percent": random.uniform(0.3, 0.8),
                },
            )
            await self._human_delay(0.5, 1.5)

    async def _detect_common_blocks(self) -> None:
        # Heuristic checks for common block states.
        blocked_texts = [
            "Try again later",
            "We restrict certain activity",
            "Your account has been disabled",
            "Suspicious Login Attempt",
            "Confirm it's you",
            "challenge_required",
        ]
        elements = await asyncio.to_thread(
            self.driver.find_elements,  # type: ignore[union-attr]
            AppiumBy.CLASS_NAME,
            "android.widget.TextView",
        )
        joined = " ".join([(e.text or "") for e in elements]).lower()
        for txt in blocked_texts:
            if txt.lower() in joined:
                if "disabled" in txt.lower() or "suspicious" in txt.lower():
                    raise BannedAccountException(txt)
                if "challenge" in txt.lower() or "confirm" in txt.lower():
                    raise CaptchaException(txt)
                raise RateLimitException(txt)

    async def _screenshot_failure(self, action: str) -> None:
        if self.driver is None:
            return
        ts = int(time.time())
        filename = f"/app/logs/{action}_{self.device_serial}_{ts}.png"
        try:
            await asyncio.to_thread(self.driver.save_screenshot, filename)
            logger.error("Saved failure screenshot %s", filename)
        except Exception:
            logger.exception("Failed to save screenshot for %s", action)

    def _map_exception(self, exc: Exception) -> Exception:
        if isinstance(exc, (RateLimitException, BannedAccountException, CaptchaException, ActionFailedException)):
            return exc
        return ActionFailedException(str(exc))

    async def _human_delay(self, low: float | None = None, high: float | None = None) -> None:
        lo = self.min_human_delay if low is None else low
        hi = self.max_human_delay if high is None else high
        await asyncio.sleep(random.uniform(lo, hi))
