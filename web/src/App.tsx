import { BrowserRouter, Routes, Route } from "react-router-dom";
import TopNav from "./components/TopNav";
import Selectors from "./components/Selectors";
import ExplorerPage from "./pages/ExplorerPage";
import HypothesisPage from "./pages/HypothesisPage";
import SyntheticPage from "./pages/SyntheticPage";
import BasketsPage from "./pages/BasketsPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <TopNav />
        <main className="page-scroll" tabIndex={0} aria-label="Analysis page">
        <Selectors />
        <Routes>
          <Route path="/" element={<ExplorerPage />} />
          <Route path="/hypothesis" element={<HypothesisPage />} />
          <Route path="/synthetic" element={<SyntheticPage />} />
          <Route path="/baskets" element={<BasketsPage />} />
        </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
