import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useEffect, useState, useCallback } from "react";

interface WebhookEvent {
  id: number;
  topic: string;
  wc_product_id: number;
  product_name: string | null;
  product_type: string | null;
  action_type: string | null;
  old_stock_status: string | null;
  new_stock_status: string | null;
  old_stock_quantity: number | null;
  new_stock_quantity: number | null;
  stock_change: number | null;
  meta_retailer_id: string | null;
  processed: number;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

interface WebhookStats {
  total: number;
  processed: number;
  errors: number;
  byAction: Record<string, number>;
  stockIncreases: number;
  stockDecreases: number;
}

interface SearchResult {
  events: WebhookEvent[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function WebhookViewer() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [stats, setStats] = useState<WebhookStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);
  const limit = 15;

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks/stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch webhook stats:", err);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit.toString());
      params.set("offset", offset.toString());
      if (search) params.set("search", search);
      if (actionFilter) params.set("actionType", actionFilter);
      if (statusFilter === "processed") params.set("processed", "true");
      if (statusFilter === "pending") params.set("processed", "false");
      if (statusFilter === "error") params.set("hasError", "true");

      const res = await fetch(`/api/webhooks?${params.toString()}`);
      const data: SearchResult = await res.json();
      setEvents(data.events);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch webhooks:", err);
    } finally {
      setLoading(false);
    }
  }, [offset, search, actionFilter, statusFilter]);

  useEffect(() => {
    fetchStats();
    fetchEvents();
  }, [fetchStats, fetchEvents]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    fetchEvents();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getActionBadge = (action: string | null) => {
    const styles: Record<string, string> = {
      created: "bg-green-100 text-green-800",
      updated: "bg-blue-100 text-blue-800",
      deleted: "bg-red-100 text-red-800",
      restored: "bg-purple-100 text-purple-800",
    };
    const style = action ? styles[action] || "bg-gray-100 text-gray-800" : "bg-gray-100 text-gray-800";
    return (
      <span className={`px-2 py-1 text-xs rounded-full font-medium ${style}`}>
        {action || "unknown"}
      </span>
    );
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

  const getStockChangeBadge = (change: number | null, oldQty: number | null, newQty: number | null) => {
    if (change === null || change === 0) return null;

    if (change > 0) {
      return (
        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 font-medium">
          +{change} ({oldQty} → {newQty})
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800 font-medium">
        {change} ({oldQty} → {newQty})
      </span>
    );
  };

  const getStockStatusChange = (oldStatus: string | null, newStatus: string | null) => {
    if (!oldStatus && !newStatus) return null;
    if (oldStatus === newStatus) return null;

    const statusColors: Record<string, string> = {
      instock: "text-green-600",
      outofstock: "text-red-600",
      onbackorder: "text-yellow-600",
    };

    return (
      <div className="text-xs">
        <span className={oldStatus ? statusColors[oldStatus] || "" : "text-gray-400"}>
          {oldStatus || "—"}
        </span>
        <span className="mx-1">→</span>
        <span className={newStatus ? statusColors[newStatus] || "" : "text-gray-400"}>
          {newStatus || "—"}
        </span>
      </div>
    );
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Events</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.processed}</div>
              <div className="text-xs text-muted-foreground">Processed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.errors}</div>
              <div className="text-xs text-muted-foreground">Errors</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.byAction?.updated || 0}</div>
              <div className="text-xs text-muted-foreground">Updates</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.stockIncreases}</div>
              <div className="text-xs text-muted-foreground">Stock +</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.stockDecreases}</div>
              <div className="text-xs text-muted-foreground">Stock -</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Events</CardTitle>
          <CardDescription>Search and filter webhook events from WooCommerce</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-4">
            <Input
              placeholder="Search by product name, ID, or retailer ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px]"
            />
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border rounded-md bg-background"
            >
              <option value="">All Actions</option>
              <option value="created">Created</option>
              <option value="updated">Updated</option>
              <option value="deleted">Deleted</option>
              <option value="restored">Restored</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border rounded-md bg-background"
            >
              <option value="">All Status</option>
              <option value="processed">Processed</option>
              <option value="pending">Pending</option>
              <option value="error">Errors</option>
            </select>
            <Button type="submit">Search</Button>
          </form>

          {/* Events Table */}
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No webhook events found.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-3 font-medium">Time</th>
                      <th className="text-left py-2 px-3 font-medium">Action</th>
                      <th className="text-left py-2 px-3 font-medium">Product</th>
                      <th className="text-left py-2 px-3 font-medium">Stock Change</th>
                      <th className="text-left py-2 px-3 font-medium">Status Change</th>
                      <th className="text-left py-2 px-3 font-medium">State</th>
                      <th className="text-left py-2 px-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr
                        key={event.id}
                        className="border-b hover:bg-muted/50 cursor-pointer"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <td className="py-3 px-3 whitespace-nowrap text-muted-foreground text-xs">
                          {formatDate(event.created_at)}
                        </td>
                        <td className="py-3 px-3">
                          {getActionBadge(event.action_type)}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium truncate max-w-[200px]" title={event.product_name || undefined}>
                            {event.product_name || `Product #${event.wc_product_id}`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            ID: {event.wc_product_id} • {event.product_type || "unknown"}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          {getStockChangeBadge(event.stock_change, event.old_stock_quantity, event.new_stock_quantity)}
                        </td>
                        <td className="py-3 px-3">
                          {getStockStatusChange(event.old_stock_status, event.new_stock_status)}
                        </td>
                        <td className="py-3 px-3">
                          {getStatusBadge(event.processed, event.error)}
                        </td>
                        <td className="py-3 px-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setSelectedEvent(event); }}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Showing {offset + 1}-{Math.min(offset + limit, total)} of {total} events
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <Card
            className="w-full max-w-2xl max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Webhook Event #{selectedEvent.id}
                  {getActionBadge(selectedEvent.action_type)}
                </CardTitle>
                <CardDescription>{formatDate(selectedEvent.created_at)}</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(null)}>
                ✕
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Product</div>
                  <div>{selectedEvent.product_name || "—"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">WooCommerce ID</div>
                  <div>{selectedEvent.wc_product_id}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Product Type</div>
                  <div>{selectedEvent.product_type || "—"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Meta Retailer ID</div>
                  <div className="font-mono text-sm">{selectedEvent.meta_retailer_id || "—"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Topic</div>
                  <code className="text-sm bg-muted px-2 py-1 rounded">{selectedEvent.topic}</code>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Status</div>
                  {getStatusBadge(selectedEvent.processed, selectedEvent.error)}
                </div>
              </div>

              {/* Stock Changes */}
              <div className="border-t pt-4">
                <div className="text-sm font-medium text-muted-foreground mb-2">Stock Changes</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Quantity</div>
                    <div className="flex items-center gap-2">
                      <span>{selectedEvent.old_stock_quantity ?? "—"}</span>
                      <span>→</span>
                      <span>{selectedEvent.new_stock_quantity ?? "—"}</span>
                      {selectedEvent.stock_change !== null && selectedEvent.stock_change !== 0 && (
                        <span className={`text-sm font-medium ${selectedEvent.stock_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ({selectedEvent.stock_change > 0 ? '+' : ''}{selectedEvent.stock_change})
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Status</div>
                    <div className="flex items-center gap-2">
                      <span>{selectedEvent.old_stock_status || "—"}</span>
                      <span>→</span>
                      <span>{selectedEvent.new_stock_status || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Error */}
              {selectedEvent.error && (
                <div className="border-t pt-4">
                  <div className="text-sm font-medium text-red-600 mb-2">Error</div>
                  <pre className="text-sm bg-red-50 text-red-800 p-3 rounded overflow-x-auto">
                    {selectedEvent.error}
                  </pre>
                </div>
              )}

              {/* Processed At */}
              {selectedEvent.processed_at && (
                <div className="border-t pt-4 text-sm text-muted-foreground">
                  Processed at: {formatDate(selectedEvent.processed_at)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
