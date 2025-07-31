import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, Users, DollarSign } from "lucide-react";

interface Bid {
  id: string;
  userId: string;
  price: number;
  quantity: number;
  timestamp: Date;
}

interface BidDistributionProps {
  bids: Bid[];
  targetAllocation: number;
  tokenSymbol: string;
}

export function BidDistribution({ bids, targetAllocation, tokenSymbol }: BidDistributionProps) {
  // Sort bids by price (highest first) and calculate filled bids
  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
  
  let filledQuantity = 0;
  const filledBids: (Bid & { filled: boolean })[] = [];
  
  sortedBids.forEach(bid => {
    const remaining = targetAllocation - filledQuantity;
    if (remaining > 0) {
      const quantityToFill = Math.min(bid.quantity, remaining);
      filledBids.push({ 
        ...bid, 
        quantity: quantityToFill,
        filled: true 
      });
      filledQuantity += quantityToFill;
      
      // If bid was partially filled, add unfilled portion
      if (bid.quantity > quantityToFill) {
        filledBids.push({
          ...bid,
          id: bid.id + '_unfilled',
          quantity: bid.quantity - quantityToFill,
          filled: false
        });
      }
    } else {
      filledBids.push({ ...bid, filled: false });
    }
  });

  // Calculate average price from filled bids only
  const actualFilledBids = filledBids.filter(bid => bid.filled);
  const totalFilledValue = actualFilledBids.reduce((sum, bid) => sum + (bid.price * bid.quantity), 0);
  const totalFilledQuantity = actualFilledBids.reduce((sum, bid) => sum + bid.quantity, 0);
  const averagePrice = totalFilledQuantity > 0 ? totalFilledValue / totalFilledQuantity : 0;

  // Group bids by price ranges for the chart
  const priceRanges: { [key: string]: { filled: number; unfilled: number; price: number } } = {};
  
  filledBids.forEach(bid => {
    const priceKey = bid.price.toFixed(4);
    if (!priceRanges[priceKey]) {
      priceRanges[priceKey] = { filled: 0, unfilled: 0, price: bid.price };
    }
    
    if (bid.filled) {
      priceRanges[priceKey].filled += bid.quantity;
    } else {
      priceRanges[priceKey].unfilled += bid.quantity;
    }
  });

  // Convert to chart data and sort by price
  const chartData = Object.values(priceRanges)
    .sort((a, b) => b.price - a.price)
    .map((range, index) => ({
      priceLabel: `$${range.price.toFixed(4)}`,
      price: range.price,
      filled: range.filled,
      unfilled: range.unfilled,
      total: range.filled + range.unfilled
    }));

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-success" />
              <span className="text-sm text-muted-foreground">Average Price</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              ${averagePrice.toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground">
              Weighted by filled quantity
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Total Bids</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {bids.length}
            </div>
            <div className="text-xs text-muted-foreground">
              {actualFilledBids.length} filled
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-accent" />
              <span className="text-sm text-muted-foreground">Allocation</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {((totalFilledQuantity / targetAllocation) * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {totalFilledQuantity.toLocaleString()} / {targetAllocation.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bid Distribution Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Bid Distribution</span>
            <div className="flex gap-2">
              <Badge variant="default" className="text-xs">
                Filled
              </Badge>
              <Badge variant="outline" className="text-xs">
                Unfilled
              </Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="priceLabel" 
                  fontSize={12}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis 
                  fontSize={12}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  label={{ 
                    value: 'Quantity', 
                    angle: -90, 
                    position: 'insideLeft',
                    style: { textAnchor: 'middle', fill: 'hsl(var(--muted-foreground))' }
                  }}
                />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold text-foreground">{label}</p>
                          <p className="text-success">
                            Filled: {data.filled.toLocaleString()} {tokenSymbol}
                          </p>
                          <p className="text-muted-foreground">
                            Unfilled: {data.unfilled.toLocaleString()} {tokenSymbol}
                          </p>
                          <p className="text-sm text-muted-foreground border-t pt-2 mt-2">
                            Total: {data.total.toLocaleString()} {tokenSymbol}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar 
                  dataKey="filled" 
                  stackId="a" 
                  fill="hsl(var(--success))" 
                  name="Filled"
                  radius={[0, 0, 0, 0]}
                />
                <Bar 
                  dataKey="unfilled" 
                  stackId="a" 
                  fill="hsl(var(--muted))" 
                  name="Unfilled"
                  radius={[2, 2, 0, 0]}
                />
                <ReferenceLine 
                  x={averagePrice} 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{ 
                    value: `Avg: $${averagePrice.toFixed(4)}`, 
                    position: "top",
                    style: { 
                      fill: 'hsl(var(--primary))', 
                      fontSize: 12,
                      fontWeight: 'bold'
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="mt-4 text-sm text-muted-foreground">
            <p>
              Bids are sorted by price (highest first). Green bars show filled quantities, 
              gray bars show unfilled quantities. The vertical dashed line shows the average price 
              calculated from all filled bids.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}