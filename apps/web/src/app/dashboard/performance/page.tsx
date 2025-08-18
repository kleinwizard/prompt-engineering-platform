import { Metadata } from 'next';
import { PerformanceDashboard } from '@/components/analytics/PerformanceDashboard';

export const metadata: Metadata = {
  title: 'Performance Dashboard | Prompt Engineering Platform',
  description: 'Monitor and optimize your prompt performance with real-time analytics',
};

export default function PerformancePage() {
  return (
    <div className="container mx-auto py-6">
      <PerformanceDashboard />
    </div>
  );
}