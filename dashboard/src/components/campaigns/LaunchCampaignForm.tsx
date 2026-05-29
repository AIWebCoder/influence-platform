"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Play, Loader2, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";

export function LaunchCampaignForm({ targetAccounts = [] }: { targetAccounts?: string[] }) {
  const { text } = useLocale();
  const lc = text.launchCampaign;
  const router = useRouter();
  const [niche, setNiche] = useState("tech");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleLaunch = async () => {
    setLoading(true);
    setSuccess(false);

    try {
      const accountsToUse = targetAccounts.length > 0 ? targetAccounts : ["system_default"];

      await api.content.generateContent({
        niche: niche,
        target_accounts: accountsToUse,
      });

      setSuccess(true);

      setTimeout(() => {
        router.refresh();
        setSuccess(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to launch campaign", error);
      alert(lc.launchError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>{lc.title}</CardTitle>
        <CardDescription>{lc.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="niche">{lc.targetNiche}</Label>
          <Select value={niche} onValueChange={setNiche} disabled={loading}>
            <SelectTrigger id="niche">
              <SelectValue placeholder={lc.selectNiche} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tech">{lc.tech}</SelectItem>
              <SelectItem value="lifestyle">{lc.lifestyle}</SelectItem>
              <SelectItem value="finance">{lc.finance}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[0.8rem] text-muted-foreground pt-1">{lc.pipelineHint}</p>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleLaunch}
          disabled={loading || success}
          variant={success ? "outline" : "default"}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {lc.orchestrating}
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> {lc.pipelineStarted}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" /> {lc.generateDistribute}
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
