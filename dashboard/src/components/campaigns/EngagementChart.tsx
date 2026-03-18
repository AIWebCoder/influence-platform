"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const data = [
  { name: "Mon", metrics: 120 },
  { name: "Tue", metrics: 250 },
  { name: "Wed", metrics: 400 },
  { name: "Thu", metrics: 380 },
  { name: "Fri", metrics: 600 },
  { name: "Sat", metrics: 850 },
  { name: "Sun", metrics: 1200 },
];

export function EngagementChart() {
  return (
    <Card className="col-span-4">
      <CardHeader>
        <CardTitle>Global Engagement</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
              <Tooltip />
              <Line type="monotone" dataKey="metrics" stroke="hsl(var(--primary))" strokeWidth={2} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
