import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Web3Provider } from "./contexts/Web3Context";
import { LaunchProvider } from "./contexts/LaunchContext";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import LaunchProject from "./pages/LaunchProject";
import Auctions from "./pages/Auctions";
import NotFound from "./pages/NotFound";

const App = () => (
  <Web3Provider>
    <LaunchProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/launch" element={<LaunchProject />} />
            <Route path="/auctions" element={<Auctions />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </LaunchProvider>
  </Web3Provider>
);

export default App;
