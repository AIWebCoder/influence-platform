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
  const chartData = data && data.length > 0 ? data : [
    { day: "01", acc1: 400, acc2: 240, acc3: 150 },
    { day: "05", acc1: 300, acc2: 139, acc3: 200 },
    { day: "10", acc1: 200, acc2: 980, acc3: 278 },
    { day: "15", acc1: 278, acc2: 390, acc3: 189 },
    { day: "20", acc1: 189, acc2: 480, acc3: 239 },
    { day: "25", acc1: 239, acc2: 380, acc3: 349 },
    { day: "30", acc1: 349, acc2: 430, acc3: 400 },
  ];

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
