import { Navigate, Route, Routes } from 'react-router-dom';
import { Architecture } from './pages/Architecture';
import { DemoConsole } from './pages/DemoConsole';
import { Landing } from './pages/Landing';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<DemoConsole />} />
      <Route path="/architecture" element={<Architecture />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
