import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { searchContacts, getOwedList, ApiError } from '../lib/api';
import type { ContactListItem } from '../types/staff';
import ClientRow from '../components/ClientRow';

export default function ClientsPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactListItem[]>([]);
  const [members, setMembers] = useState<ContactListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMembersLoading, setIsMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { roster } = await getOwedList();
        if (cancelled) return;

        setMembers((roster || []).map((member) => ({
          id: member.contactId,
          name: member.name,
          email: '',
          phone: '',
          lastAppointment: member.lastSessionMs
            ? new Date(member.lastSessionMs).toISOString()
            : null,
          sessionsRemaining: 0,
          seriesType: 'none',
        })));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        if (!cancelled) setMembersError(true);
      } finally {
        if (!cancelled) setIsMembersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [logout]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    setHasSearched(false);
    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchContacts(query.trim());
        setSearchResults(results);
        setHasSearched(true);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setSearchResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const showingSearch = Boolean(query.trim());
  const contacts = showingSearch ? searchResults : members;
  const isLoading = showingSearch ? isSearching : isMembersLoading;

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="staff-pagehead text-xl font-serif text-amari-charcoal">Practice Members</h1>

      {/* Search across the full GHL contact database (members, leads, anyone). */}
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
      ) : !showingSearch && membersError ? (
        <div className="text-center py-12">
          <p className="text-amari-text-muted text-sm">Couldn’t load practice members</p>
        </div>
      ) : !showingSearch ? (
        <>
          <p className="staff-mlabel mb-2">Current practice members · latest session first</p>
          {contacts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-amari-text-muted text-sm">No current practice members</p>
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
        </>
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
