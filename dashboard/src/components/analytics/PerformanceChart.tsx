"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

export function PerformanceChart({ data }: { data?: any[] }) {
  const chartData = data && data.length > 0 ? data : [];
  if (chartData.length === 0) {
    return (
      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Engagement Comparison</CardTitle>
          <CardDescription>
            Multi-account interactions over the last 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="pl-2">
          <p className="text-sm text-muted-foreground p-4">No analytics data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const keys = Object.keys(chartData[0]).filter(k => k !== "day");

  const colors = [
    "hsl(var(--primary))",
    "hsl(var(--destructive))",
    "hsl(var(--accent))",
    "#10b981",
    "#f59e0b",
    "#8b5cf6"
  ];

  return (
    <Card className="col-span-4">
      <CardHeader>
        <CardTitle>Engagement Comparison</CardTitle>
        <CardDescription>
          Multi-account interactions over the last 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <XAxis dataKey="day" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
              <Tooltip />
              <Legend verticalAlign="top" height={36}/>
              {keys.map((key, index) => (
                <Line 
                  key={key} 
                  type="monotone" 
                  dataKey={key} 
                  name={key.replace('acc_', '')} 
                  stroke={colors[index % colors.length]} 
                  strokeWidth={2} 
                  activeDot={index === 0 ? { r: 8 } : undefined} 
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
