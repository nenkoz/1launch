import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Rocket, TrendingUp, Shield, Zap } from "lucide-react";
import { Link } from "react-router-dom";

export function Hero() {
  return (
    <div className="relative overflow-hidden bg-gradient-hero">
      <div className="absolute inset-0 opacity-10">
        <div className="w-full h-full bg-repeat" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }}></div>
      </div>
      
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center space-y-8">
          <Badge variant="secondary" className="inline-flex items-center gap-2 px-4 py-2 animate-float">
            <Zap className="w-4 h-4 text-accent" />
            Dutch Auction Launchpad
          </Badge>
          
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground leading-tight">
              Launch Your{" "}
              <span className="bg-gradient-primary bg-clip-text text-transparent animate-glow-pulse">
                Crypto Project
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Fair price discovery through Dutch auctions. Connect with investors and build the future of decentralized finance.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="gradient" size="lg" className="px-8 py-4 text-lg font-semibold" asChild>
              <Link to="/launch">
                <Rocket className="w-5 h-5 mr-2" />
                Launch Project
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="px-8 py-4 text-lg" asChild>
              <Link to="/auctions">
                View Auctions
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-4xl mx-auto">
            <div className="bg-gradient-card backdrop-blur-sm border border-accent/20 rounded-xl p-6 hover:border-accent/40 transition-all duration-300">
              <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mb-4 mx-auto">
                <TrendingUp className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Fair Price Discovery</h3>
              <p className="text-muted-foreground text-sm">
                Dutch auctions ensure fair market pricing by starting high and decreasing until demand meets supply.
              </p>
            </div>

            <div className="bg-gradient-card backdrop-blur-sm border border-accent/20 rounded-xl p-6 hover:border-accent/40 transition-all duration-300">
              <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mb-4 mx-auto">
                <Shield className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Secure & Transparent</h3>
              <p className="text-muted-foreground text-sm">
                All transactions are on-chain and verifiable. Smart contracts ensure trustless execution.
              </p>
            </div>

            <div className="bg-gradient-card backdrop-blur-sm border border-accent/20 rounded-xl p-6 hover:border-accent/40 transition-all duration-300">
              <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mb-4 mx-auto">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Instant Settlement</h3>
              <p className="text-muted-foreground text-sm">
                Fast and efficient token distribution with immediate liquidity for successful auctions.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}