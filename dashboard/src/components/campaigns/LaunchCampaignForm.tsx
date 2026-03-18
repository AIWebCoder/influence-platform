"use client";

import { useState } from "react";
import { api } from "@/lib/api";
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
        target_accounts: accountsToUse
      });

      setSuccess(true);
      
      setTimeout(() => {
        router.refresh();
        setSuccess(false);
      }, 2000);

    } catch (error) {
      console.error("Failed to launch campaign", error);
      alert("Erreur lors du lancement de la campagne. Le Content Factory est-il allumé ?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="col-span-3">
      <CardHeader>
        <CardTitle>Launch Campaign</CardTitle>
        <CardDescription>
          Trigger end-to-end AI generation and distribution.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="niche">Target Niche</Label>
          <Select value={niche} onValueChange={setNiche} disabled={loading}>
            <SelectTrigger id="niche">
              <SelectValue placeholder="Select a niche" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tech">Technology Startups</SelectItem>
              <SelectItem value="lifestyle">Lifestyle & Fashion</SelectItem>
              <SelectItem value="finance">Crypto & Trading</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[0.8rem] text-muted-foreground pt-1">
            Activating this pipeline will prompt Claude API to generate a caption and place it in the remote Redis queue.
          </p>
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
             <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Orchestrating...</>
          ) : success ? (
            <><CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> Pipeline Started</>
          ) : (
            <><Play className="mr-2 h-4 w-4" /> Generate & Distribute</>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
