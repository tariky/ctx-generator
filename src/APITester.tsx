import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRef, type FormEvent } from "react";

export function APITester() {
  const responseInputRef = useRef<HTMLTextAreaElement>(null);

  const testEndpoint = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      const endpoint = formData.get("endpoint") as string;
      const url = new URL(endpoint, location.href);
      const method = formData.get("method") as string;
      const res = await fetch(url, { method });

      const data = await res.json();
      responseInputRef.current!.value = JSON.stringify(data, null, 2);
    } catch (error) {
      responseInputRef.current!.value = String(error);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={testEndpoint} className="flex items-center gap-2">
        <Label htmlFor="method" className="sr-only">
          Method
        </Label>
        <Select name="method" defaultValue="GET">
          <SelectTrigger className="w-[100px]" id="method">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
          </SelectContent>
        </Select>
        <Label htmlFor="endpoint" className="sr-only">
          Endpoint
        </Label>
        <Input id="endpoint" type="text" name="endpoint" defaultValue="/api/hello" placeholder="/api/hello" />
        <Button type="submit" variant="secondary">
          Send
        </Button>
      </form>
      <Label htmlFor="response" className="sr-only">
        Response
      </Label>
      <Textarea
        ref={responseInputRef}
        id="response"
        readOnly
        placeholder="Response will appear here..."
        className="min-h-[140px] font-mono resize-y"
      />
      <div className="flex flex-col gap-4 items-center pt-4 border-t">
        <div className="flex gap-4">
          <Button 
            onClick={async () => {
              try {
                const res = await fetch("/api/catalog/generate", { method: "GET" });
                const data = await res.json();
                responseInputRef.current!.value = JSON.stringify(data, null, 2);
              } catch (e) {
                responseInputRef.current!.value = String(e);
              }
            }} 
            variant="outline"
          >
            Generate Both Catalogs (GET)
          </Button>
        </div>
        <div className="flex gap-4 flex-wrap justify-center">
          <Button asChild variant="default">
            <a href="/product_catalog_standard.csv" target="_blank" rel="noreferrer">
              Download Standard CSV
            </a>
          </Button>
          <Button asChild variant="default">
            <a href="/product_catalog_christmas.csv" target="_blank" rel="noreferrer">
              Download Christmas CSV
            </a>
          </Button>
        </div>
        <div className="text-sm text-muted-foreground text-center">
          Or download directly (dynamic): 
          <a href="/api/catalog?style=standard" className="underline hover:text-foreground mx-1">/api/catalog?style=standard</a>
          or
          <a href="/api/catalog?style=christmas" className="underline hover:text-foreground mx-1">/api/catalog?style=christmas</a>
        </div>
      </div>
    </div>
  );
}
