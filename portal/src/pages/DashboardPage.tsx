import PortalNav from '../components/PortalNav';
import PracticeDashboardPage from './PracticeDashboardPage';
import { useClientData } from '../hooks/useClientData';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardPage() {
  const { email } = useAuth();
  const { data, isLoading, error, refetch } = useClientData();

  const firstName = data?.client?.firstName || data?.client?.lastName || email?.split('@')[0] || 'there';

  if (isLoading) {
    return (
      <div className="cp-screen">
        <PortalNav firstName={firstName} hasLivingPractice={false} />
        <section className="cp-greet">
          <div className="cp-greet-l">
            <h1 className="cp-hello">Hey, <em>{firstName}.</em></h1>
            <p className="cp-greet-sub">Loading your portal…</p>
          </div>
        </section>
        <section className="cp-journey">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
            <span className="cp-verify-spinner" aria-hidden="true"></span>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cp-screen">
        <PortalNav firstName={firstName} hasLivingPractice={false} />
        <section className="cp-greet">
          <div className="cp-greet-l">
            <h1 className="cp-hello">Hey, <em>{firstName}.</em></h1>
            <p className="cp-greet-sub">Welcome back.</p>
          </div>
        </section>
        <section className="cp-error">
          <span className="cp-mono cp-accent">Connection lost</span>
          <h2 className="cp-error-h">We <em>can't reach</em> your portal right now.</h2>
          <p className="cp-error-p">{error}</p>
          <div className="cp-error-actions">
            <button type="button" className="cp-btn cp-btn-primary" onClick={refetch}>
              <span>Try again</span><span className="cp-arrow">→</span>
            </button>
            <a href="mailto:hello@amarimethod.com" className="cp-btn cp-btn-ghost">Contact Garrett</a>
          </div>
        </section>
      </div>
    );
  }

  if (!data) return null;

  // Founders receive the same practice home as everyone else. Their existing
  // balances and access remain visible there, but no legacy package checkout
  // or repurchase offer is exposed in the portal.
  return <PracticeDashboardPage data={data} onRefetch={refetch} />;
}
