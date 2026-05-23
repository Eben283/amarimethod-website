import { Link } from 'react-router-dom';
import { Search, ArrowRight } from 'lucide-react';

export default function ClientsPage() {
  return (
    <div className="px-4 pt-6 pb-4 max-w-4xl mx-auto">
      <h1 className="text-xl font-serif text-amari-charcoal mb-4">Clients</h1>

      <div className="bg-white rounded-md border border-amari-border p-4">
        <p className="text-sm text-amari-charcoal mb-3">
          Looking for a specific contact? Search lives in <strong>Outreach</strong> now.
        </p>
        <Link
          to="/outreach"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amari-accent-warm hover:underline"
        >
          <Search className="w-4 h-4" />
          Search all contacts
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <p className="text-xs text-amari-text-muted mt-4 px-1">
        Active client list coming soon — for now, search in Outreach or open from Schedule.
      </p>
    </div>
  );
}
