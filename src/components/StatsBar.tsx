import { TrendingUp, DollarSign, Users, Activity } from "lucide-react";

export function StatsBar() {
  const stats = [
    {
      label: "Total Volume",
      value: "$24.7M",
      change: "+12.3%",
      icon: DollarSign,
      isPositive: true,
    },
    {
      label: "Active Auctions",
      value: "8",
      change: "+2",
      icon: Activity,
      isPositive: true,
    },
    {
      label: "Participants",
      value: "1,247",
      change: "+8.1%",
      icon: Users,
      isPositive: true,
    },
    {
      label: "Avg. Price Drop",
      value: "15.2%",
      change: "-2.1%",
      icon: TrendingUp,
      isPositive: false,
    },
  ];

  return (
    <div className="bg-gradient-card backdrop-blur-sm border-y border-accent/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, index) => (
            <div key={index} className="text-center">
              <div className="flex items-center justify-center mb-2">
                <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
                  <stat.icon className="w-4 h-4 text-primary-foreground" />
                </div>
              </div>
              <div className="text-2xl font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
              <div className={`text-xs font-medium ${
                stat.isPositive ? 'text-success' : 'text-destructive'
              }`}>
                {stat.change}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}