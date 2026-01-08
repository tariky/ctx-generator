import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState, useCallback } from "react";

interface SyncStats {
  products: {
    total: number;
    inStock: number;
  };
  sync: {
    synced: number;
    pending: number;
    errors: number;
  };
  webhooks: {
    total: number;
    processed: number;
    errors: number;
  };
  recentWebhooks: WebhookEvent[];
}

interface WebhookEvent {
  id: number;
  topic: string;
  wc_product_id: number;
  processed: number;
  error: string | null;
  created_at: string;
}

interface TaskProgress {
  active: boolean;
  task: string;
  message: string;
  startTime?: number;
  elapsed?: number;
}

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Task progress state
  const [progress, setProgress] = useState<TaskProgress>({
    active: false,
    task: "",
    message: "",
  });

  // Results
  const [lastResult, setLastResult] = useState<{
    task: string;
    success: boolean;
    message: string;
    elapsed?: number;
  } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/sync/status");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setStats(data);
        setError(null);
      }
    } catch (err) {
      setError("Failed to fetch stats");
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Timer for elapsed time during tasks
  useEffect(() => {
    if (!progress.active || !progress.startTime) return;

    const interval = setInterval(() => {
      setProgress(prev => ({
        ...prev,
        elapsed: Date.now() - (prev.startTime || Date.now()),
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [progress.active, progress.startTime]);

  const startTask = (task: string, message: string) => {
    setProgress({
      active: true,
      task,
      message,
      startTime: Date.now(),
      elapsed: 0,
    });
    setLastResult(null);
  };

  const endTask = (success: boolean, message: string, elapsed?: number) => {
    const finalElapsed = elapsed || (progress.startTime ? Date.now() - progress.startTime : 0);
    setProgress({ active: false, task: "", message: "" });
    setLastResult({
      task: progress.task,
      success,
      message,
      elapsed: finalElapsed,
    });
  };

  const handleInitialSync = async () => {
    startTask("sync", "Fetching products from WooCommerce and syncing to Meta Catalog...");
    try {
      const res = await fetch("/api/sync/initial", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        endTask(true, `Synced ${data.report.synced} products (${data.report.created} created, ${data.report.updated} updated, ${data.report.errors} errors)`);
        fetchStats();
      } else {
        endTask(false, data.error || "Sync failed");
      }
    } catch (err) {
      endTask(false, String(err));
    }
  };

  const handleGenerateFast = async () => {
    startTask("generate-fast", "Generating CSV catalogs from cache...");
    try {
      const res = await fetch("/api/catalog/generate");
      const data = await res.json();
      if (data.success) {
        endTask(true, `Generated both catalogs`, data.elapsed);
        fetchStats();
      } else {
        endTask(false, data.error || "Generation failed");
      }
    } catch (err) {
      endTask(false, String(err));
    }
  };

  const handleGenerateRefresh = async () => {
    startTask("generate-refresh", "Fetching fresh data from WooCommerce and generating CSVs...");
    try {
      const res = await fetch("/api/catalog/generate?refresh=true");
      const data = await res.json();
      if (data.success) {
        endTask(true, `Generated both catalogs with fresh data`, data.elapsed);
        fetchStats();
      } else {
        endTask(false, data.error || "Generation failed");
      }
    } catch (err) {
      endTask(false, String(err));
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusBadge = (processed: number, error: string | null) => {
    if (error) {
      return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Error</span>;
    }
    if (processed) {
      return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Processed</span>;
    }
    return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Progress indeterminate className="w-48 mb-4" />
          <div className="text-lg">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Meta Catalog Sync Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Last refresh: {lastRefresh.toLocaleTimeString()}
            </span>
            <Button variant="outline" size="sm" onClick={fetchStats} disabled={progress.active}>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Progress Bar */}
        {progress.active && (
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-blue-800">{progress.task}</span>
                <span className="text-sm text-blue-600">
                  {progress.elapsed ? formatElapsed(progress.elapsed) : "Starting..."}
                </span>
              </div>
              <Progress indeterminate className="mb-2" />
              <p className="text-sm text-blue-700">{progress.message}</p>
            </CardContent>
          </Card>
        )}

        {/* Last Result */}
        {lastResult && !progress.active && (
          <Card className={`mb-6 ${lastResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-lg ${lastResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {lastResult.success ? '✓' : '✗'}
                  </span>
                  <span className={`font-medium ${lastResult.success ? 'text-green-800' : 'text-red-800'}`}>
                    {lastResult.message}
                  </span>
                </div>
                {lastResult.elapsed && (
                  <span className={`text-sm ${lastResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    Completed in {formatElapsed(lastResult.elapsed)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
            {error}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Products</CardDescription>
              <CardTitle className="text-3xl">{stats?.products.total || 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                In stock: <span className="font-medium text-green-600">{stats?.products.inStock || 0}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Synced to Meta</CardDescription>
              <CardTitle className="text-3xl text-green-600">{stats?.sync.synced || 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Products in Meta Catalog
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Pending Sync</CardDescription>
              <CardTitle className="text-3xl text-yellow-600">{stats?.sync.pending || 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Awaiting synchronization
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Sync Errors</CardDescription>
              <CardTitle className="text-3xl text-red-600">{stats?.sync.errors || 0}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Failed to sync
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>Sync products and generate catalogs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Sync Section */}
            <div className="space-y-3">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Sync with Meta Catalog</h3>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleInitialSync}
                  disabled={progress.active}
                  size="lg"
                >
                  {progress.active && progress.task === "sync" ? (
                    <>
                      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Syncing...
                    </>
                  ) : (
                    "Run Initial Sync"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Fetches in-stock products from WooCommerce, stores in database, and syncs to Meta Catalog API
              </p>
            </div>

            <div className="border-t pt-6 space-y-3">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Generate CSV Catalogs</h3>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleGenerateFast}
                  disabled={progress.active}
                  variant="default"
                  size="lg"
                >
                  {progress.active && progress.task === "generate-fast" ? (
                    <>
                      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Generating...
                    </>
                  ) : (
                    <>Generate CSVs (Fast)</>
                  )}
                </Button>
                <Button
                  onClick={handleGenerateRefresh}
                  disabled={progress.active}
                  variant="outline"
                  size="lg"
                >
                  {progress.active && progress.task === "generate-refresh" ? (
                    <>
                      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Refreshing...
                    </>
                  ) : (
                    <>Refresh from WooCommerce & Generate</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Fast:</strong> Uses cached data (~100ms) • <strong>Refresh:</strong> Fetches fresh from WooCommerce first (slower)
              </p>
            </div>

            <div className="border-t pt-6 space-y-3">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Download Generated Files</h3>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" asChild>
                  <a href="/product_catalog_standard.csv" target="_blank">
                    Download Standard CSV
                  </a>
                </Button>
                <Button variant="secondary" asChild>
                  <a href="/product_catalog_christmas.csv" target="_blank">
                    Download Christmas CSV
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Download the last generated CSV files (only in-stock products)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Webhook Stats */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Webhook Statistics</CardTitle>
            <CardDescription>WooCommerce webhook events received</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{stats?.webhooks.total || 0}</div>
                <div className="text-sm text-muted-foreground">Total Events</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{stats?.webhooks.processed || 0}</div>
                <div className="text-sm text-muted-foreground">Processed</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{stats?.webhooks.errors || 0}</div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Webhooks */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Recent Webhook Events</CardTitle>
            <CardDescription>Last 5 webhook events received from WooCommerce</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.recentWebhooks && stats.recentWebhooks.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-4 font-medium">Time</th>
                      <th className="text-left py-2 px-4 font-medium">Topic</th>
                      <th className="text-left py-2 px-4 font-medium">Product ID</th>
                      <th className="text-left py-2 px-4 font-medium">Status</th>
                      <th className="text-left py-2 px-4 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentWebhooks.map((event) => (
                      <tr key={event.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                          {formatDate(event.created_at)}
                        </td>
                        <td className="py-3 px-4">
                          <code className="bg-muted px-2 py-1 rounded text-xs font-mono">
                            {event.topic}
                          </code>
                        </td>
                        <td className="py-3 px-4 font-mono">{event.wc_product_id}</td>
                        <td className="py-3 px-4">
                          {getStatusBadge(event.processed, event.error)}
                        </td>
                        <td className="py-3 px-4 text-red-600 text-xs max-w-xs truncate">
                          {event.error || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No webhook events yet.</p>
                <p className="text-sm mt-1">Configure your WooCommerce webhooks to start receiving events.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook Setup Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Webhook Setup Guide</CardTitle>
            <CardDescription>Configure WooCommerce to send real-time product updates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <p className="font-medium mb-2">Webhook URL:</p>
              <code className="bg-background px-3 py-2 rounded block text-sm break-all">
                {window.location.origin}/api/webhooks/woocommerce
              </code>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Go to <strong className="text-foreground">WooCommerce → Settings → Advanced → Webhooks</strong></li>
              <li>Click <strong className="text-foreground">Add webhook</strong></li>
              <li>Set the <strong className="text-foreground">Delivery URL</strong> to the URL above</li>
              <li>Create webhooks for these topics:
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li><code className="bg-muted px-1 rounded">Product created</code></li>
                  <li><code className="bg-muted px-1 rounded">Product updated</code></li>
                  <li><code className="bg-muted px-1 rounded">Product deleted</code></li>
                </ul>
              </li>
              <li>Set the <strong className="text-foreground">Secret</strong> to match your <code className="bg-muted px-1 rounded">WC_WEBHOOK_SECRET</code> environment variable</li>
            </ol>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
