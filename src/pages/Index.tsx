import { Navigation } from '@/components/Navigation';
import { Hero } from '@/components/Hero';
import { StatsBar } from '@/components/StatsBar';
import { LaunchCard } from '@/components/LaunchCard';
import { BidForm } from '@/components/BidForm';

const Index = () => {
  // Mock launch data
  const launches = [
    {
      id: '1',
      tokenName: 'EcoToken',
      tokenSymbol: 'ECO',
      description:
        'Revolutionary green energy token powering sustainable blockchain infrastructure',
      endTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
      totalSupply: 1000000,
      targetAllocation: 400000, // 40% of total
      participants: 156,
      isLaunched: false,
    },
    {
      id: '2',
      tokenName: 'GameFi Pro',
      tokenSymbol: 'GFP',
      description:
        'Next-generation gaming platform connecting players and developers worldwide',
      endTime: new Date(Date.now() + 5 * 60 * 60 * 1000), // 5 hours from now
      totalSupply: 500000,
      targetAllocation: 200000, // 40% of total
      participants: 98,
      isLaunched: false,
    },
    {
      id: '3',
      tokenName: 'MetaVerse',
      tokenSymbol: 'META',
      description:
        'Building the infrastructure for virtual worlds and digital experiences',
      endTime: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago (completed)
      totalSupply: 750000,
      targetAllocation: 300000, // 40% of total
      participants: 203,
      isLaunched: true,
      bids: [
        {
          id: 'b1',
          userId: 'u1',
          price: 0.135,
          quantity: 50000,
          timestamp: new Date(),
        },
        {
          id: 'b2',
          userId: 'u2',
          price: 0.128,
          quantity: 75000,
          timestamp: new Date(),
        },
        {
          id: 'b3',
          userId: 'u3',
          price: 0.124,
          quantity: 100000,
          timestamp: new Date(),
        },
        {
          id: 'b4',
          userId: 'u4',
          price: 0.122,
          quantity: 80000,
          timestamp: new Date(),
        },
        {
          id: 'b5',
          userId: 'u5',
          price: 0.12,
          quantity: 120000,
          timestamp: new Date(),
        },
      ],
    },
  ];

  const handleBidSubmit = async (
    launchId: string,
    price: number,
    quantity: number
  ) => {
    console.log('Bid submitted:', { launchId, price, quantity });
    // Here we would integrate with 1inch private orders API
    // For now, just simulate the bid submission
  };
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="pt-16">
        <Hero />
        <StatsBar />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          {/* Live Launches Section */}
          <section id="launches" className="mb-16">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
                Private Bid Launches
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Submit private bids during the launch period. Highest bids are
                filled first until 40% allocation is reached.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {launches.map(launch => (
                <div key={launch.id} className="space-y-4">
                  <LaunchCard {...launch} />
                </div>
              ))}
            </div>
          </section>

          {/* How It Works */}
          <section className="text-center">
            <h2 className="text-3xl font-bold text-foreground mb-8">
              How Private Bid Launches Work
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mx-auto text-2xl font-bold text-primary-foreground">
                  1
                </div>
                <h3 className="text-xl font-semibold text-foreground">
                  Submit Private Bids
                </h3>
                <p className="text-muted-foreground">
                  Place bids with your desired price and quantity during the
                  launch period
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mx-auto text-2xl font-bold text-primary-foreground">
                  2
                </div>
                <h3 className="text-xl font-semibold text-foreground">
                  Highest Bids Win
                </h3>
                <p className="text-muted-foreground">
                  After launch ends, bids are filled from highest price until
                  40% allocation is reached
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mx-auto text-2xl font-bold text-primary-foreground">
                  3
                </div>
                <h3 className="text-xl font-semibold text-foreground">
                  Liquidity Pool Created
                </h3>
                <p className="text-muted-foreground">
                  40% tokens + collected funds go to liquidity pool, 20%
                  reserved for dev wallet
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Index;
