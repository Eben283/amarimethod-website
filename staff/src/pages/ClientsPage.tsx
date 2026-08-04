import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { searchContacts, ApiError } from '../lib/api';
import type { ContactListItem } from '../types/staff';
import ClientRow from '../components/ClientRow';

export default function ClientsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setContacts([]);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await searchContacts(query.trim());
        setContacts(results);
        setHasSearched(true);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setContacts([]);
        setHasSearched(true);
      } finally {
        setIsLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="staff-pagehead text-xl font-serif text-amari-charcoal">Practice Members</h1>

      {/* Search across the full GHL contact database (clients, leads, anyone). */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-amari-text-muted" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="staff-input pl-10"
          autoComplete="off"
          autoCapitalize="off"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-amari-charcoal animate-spin" />
        </div>
      ) : !hasSearched ? (
        <div className="text-center py-12">
          <p className="text-amari-text-muted text-sm">Type to search practice members</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-amari-text-muted text-sm">No practice members found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((contact) => (
            <ClientRow
              key={contact.id}
              contact={contact}
              onTap={() => navigate(`/client/${contact.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
