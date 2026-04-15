"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateTimePickerProps {
  value: Date | undefined
  onChange: (date: Date | undefined) => void
  placeholder?: string
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick a date & time",
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  const timeValue = value
    ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
    : ""

  const handleDateSelect = (day: Date | undefined) => {
    if (!day) {
      onChange(undefined)
      return
    }
    // Preserve existing time when selecting a new date
    const merged = new Date(day)
    if (value) {
      merged.setHours(value.getHours(), value.getMinutes(), 0, 0)
    }
    onChange(merged)
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = e.target.value.split(":").map(Number)
    const base = value ? new Date(value) : new Date()
    base.setHours(hours || 0, minutes || 0, 0, 0)
    onChange(base)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          data-empty={!value}
          className={cn(
            "w-full justify-start text-left font-normal",
            "data-[empty=true]:text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "PPP 'at' HH:mm") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={handleDateSelect}
          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
          initialFocus
        />
        <div className="border-t border-border px-3 py-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarIcon className="h-4 w-4" />
            Time
            <Input
              type="time"
              value={timeValue}
              onChange={handleTimeChange}
              className="ml-auto h-8 w-[120px]"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
