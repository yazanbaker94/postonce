import { Navigate, Route, Routes } from 'react-router-dom';
import { Architecture } from './pages/Architecture';
import { Landing } from './pages/Landing';
import {
  ActivityPage,
  ClosePage,
  DepositDetailPage,
  DepositsPage,
  ExceptionDetailPage,
  ExceptionsPage,
  IntegrationsPage,
  PaymentDetailPage,
  PaymentsPage,
  ProductApp,
  ProductIndex,
  ProductNotFound,
} from './product/ProductApp';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/architecture" element={<Architecture />} />
      <Route path="/demo" element={<Navigate to="/app/close" replace />} />
      <Route path="/app" element={<ProductApp />}>
        <Route index element={<ProductIndex />} />
        <Route path="close" element={<ClosePage />} />
        <Route path="exceptions" element={<ExceptionsPage />} />
        <Route path="exceptions/:exceptionId" element={<ExceptionDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="payments/:paymentId" element={<PaymentDetailPage />} />
        <Route path="deposits" element={<DepositsPage />} />
        <Route path="deposits/:payoutId" element={<DepositDetailPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="*" element={<ProductNotFound />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
