import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  PackagePlus,
  Plus,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createStaffProduct,
  getStaffProducts,
  type StaffProduct,
  type StaffProductPolicy,
} from '../lib/api';
import './ProductsPage.css';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const groupCopy: Record<StaffProductPolicy, { title: string; detail: string }> = {
  current: { title: 'Current offers', detail: 'The products Staff can use for current Amari sales.' },
  custom: { title: 'Custom products', detail: 'Reusable simple items created inside Staff.' },
  legacy: { title: 'Legacy · Staff only', detail: 'Founding-member support. Never share or send these prices.' },
};

function ProductRow({ product }: { product: StaffProduct }) {
  const navigate = useNavigate();
  const ready = product.readiness === 'ready' && product.availableInPos;
  const noEffect = product.fulfillmentPolicy === 'none';
  return (
    <article className={`staff-product-row staff-product-row--${product.salesPolicy}`}>
      <div className="staff-product-row__identity">
        <div>
          <span className="staff-product-row__policy">
            {product.salesPolicy === 'legacy' ? 'Legacy · Founding members only' : product.salesPolicy === 'custom' ? 'Custom' : 'Current'}
          </span>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
        </div>
        <strong>{money.format(product.amountCents / 100)}</strong>
      </div>

      <div className="staff-product-effect" aria-label={`After payment for ${product.name}`}>
        <span><ReceiptText aria-hidden="true" /> After payment</span>
        <p>{product.fulfillmentSummary}</p>
        {noEffect ? <small>Payment record only · no provider product is created</small> : null}
      </div>

      <div className="staff-product-row__actions">
        <span className={ready ? 'is-ready' : 'needs-repair'}>
          {ready ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          {ready ? 'Ready in POS' : 'Fulfillment repair required'}
        </span>
        {ready ? (
          <button type="button" onClick={() => navigate(`/pos?product=${encodeURIComponent(product.key)}`)}>
            Add to POS <ArrowRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {!ready && product.readinessReason ? <p className="staff-product-row__warning">{product.readinessReason}</p> : null}
    </article>
  );
}

function ProductGroup({ policy, products, collapsed = false }: { policy: StaffProductPolicy; products: StaffProduct[]; collapsed?: boolean }) {
  const copy = groupCopy[policy];
  if (collapsed) {
    return (
      <details className="staff-product-group staff-product-group--legacy">
        <summary>
          <span><strong>{copy.title}</strong><small>{copy.detail}</small></span>
          <span>{products.length} products <ChevronDown aria-hidden="true" /></span>
        </summary>
        <div className="staff-product-group__rows">{products.map((product) => <ProductRow key={product.key} product={product} />)}</div>
      </details>
    );
  }
  return (
    <section className="staff-product-group" aria-labelledby={`products-${policy}`}>
      <header><div><h2 id={`products-${policy}`}>{copy.title}</h2><p>{copy.detail}</p></div><span>{products.length}</span></header>
      {products.length ? (
        <div className="staff-product-group__rows">{products.map((product) => <ProductRow key={product.key} product={product} />)}</div>
      ) : (
        <div className="staff-product-empty">
          <PackagePlus aria-hidden="true" />
          <strong>No reusable custom products yet.</strong>
          <p>Create one here, or add a one-time item in POS.</p>
        </div>
      )}
    </section>
  );
}

function NewProductSheet({ onSaved }: { onSaved: (product: StaffProduct) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<StaffProduct['category']>('retail');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [available, setAvailable] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = Math.round(Number(price) * 100);
    if (!name.trim() || !Number.isSafeInteger(amountCents) || amountCents < 1 || !reason.trim() || !acknowledged) {
      setError('Add the required details and confirm the fulfillment boundary.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await createStaffProduct({
        requestId: crypto.randomUUID(),
        name: name.trim(),
        amountCents,
        category,
        description: description.trim(),
        internalReason: reason.trim(),
        availableInPos: available,
      });
      onSaved(result.product);
      navigate('/products', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Product could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="staff-product-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) navigate('/products'); }}>
      <aside className="staff-product-sheet" role="dialog" aria-modal="true" aria-labelledby="new-product-title">
        <header>
          <div><span>Reusable Staff item</span><h2 id="new-product-title">New custom product</h2></div>
          <button type="button" onClick={() => navigate('/products')} aria-label="Close new product"><X aria-hidden="true" /></button>
        </header>
        <p className="staff-product-sheet__intro">Save an owned reusable item for Staff POS. This does not create a Stripe catalog product or start fulfillment.</p>
        <form onSubmit={submit}>
          <label>Product name <span>*</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /><small>Staff sees this in Products and POS. It may appear on the payment receipt.</small></label>
          <label>Price <span>*</span><div className="staff-product-sheet__money"><i>$</i><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.00" required /></div><small>Price for one item. Quantity is chosen in the cart.</small></label>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value as StaffProduct['category'])}><option value="retail">Retail item</option><option value="practice-support">Practice support</option><option value="service">Service fee</option></select></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} rows={3} /><small>Short Staff-facing context for the catalog.</small></label>
          <label>Internal reason <span>*</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={120} placeholder="Equipment, event fee, replacement item…" required /><small>Staff only. Explain why this item exists.</small></label>
          <label className="staff-product-sheet__toggle"><input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} /><span><strong>Available in POS</strong><small>Turn this off to keep the record without offering it in new carts.</small></span></label>
          <section className="staff-product-boundary">
            <span>What happens after payment</span>
            <p>Payment is recorded. No sessions are added. No portal or Living Practice access is granted. No appointment is booked. No automation starts.</p>
          </section>
          <label className="staff-product-sheet__ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /><span>I understand this product has no automatic fulfillment.</span></label>
          {error ? <p className="staff-product-sheet__error" role="alert">{error}</p> : null}
          <footer><button type="button" onClick={() => navigate('/products')}>Cancel</button><button type="submit" disabled={saving}>{saving ? <Loader2 aria-hidden="true" /> : <Plus aria-hidden="true" />} {saving ? 'Saving…' : 'Save custom product'}</button></footer>
        </form>
      </aside>
    </div>
  );
}

export default function ProductsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [products, setProducts] = useState<StaffProduct[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getStaffProducts();
      setProducts(result.products);
      setCanCreate(result.canCreate);
      if (result.storage === 'unavailable') setError('Custom-product storage is not ready. The built-in catalog is still visible.');
    } catch {
      setError('Product catalog could not be verified. Existing carts remain available, but new products cannot be added.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const groups = useMemo(() => ({
    current: products.filter((product) => product.salesPolicy === 'current'),
    custom: products.filter((product) => product.salesPolicy === 'custom'),
    legacy: products.filter((product) => product.salesPolicy === 'legacy'),
  }), [products]);
  const newProductOpen = location.pathname.endsWith('/new');

  return (
    <main className="staff-products-page">
      <header className="staff-products-head">
        <div><span>Staff catalog</span><h1>Products</h1><p>What Staff can add in POS, and exactly what happens after payment.</p></div>
        <div className="staff-products-head__actions">
          <button type="button" onClick={() => navigate('/pos')}><ShoppingBag aria-hidden="true" /> Open POS</button>
          {canCreate ? <button type="button" className="is-primary" onClick={() => navigate('/products/new')}><Plus aria-hidden="true" /> New custom product</button> : null}
        </div>
      </header>

      {notice ? <div className="staff-products-notice"><Check aria-hidden="true" /> {notice}</div> : null}
      {error ? <div className="staff-products-error"><AlertTriangle aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Retry</button></div> : null}
      {loading ? <div className="staff-products-loading"><Loader2 aria-hidden="true" /> Verifying the product catalog…</div> : (
        <div className="staff-products-groups">
          <ProductGroup policy="current" products={groups.current} />
          <ProductGroup policy="custom" products={groups.custom} />
          <ProductGroup policy="legacy" products={groups.legacy} collapsed />
        </div>
      )}
      {!canCreate && !loading ? <p className="staff-products-owner-note">Eben controls catalog creation. Both staff members can view products and use ready items in POS.</p> : null}
      {newProductOpen && canCreate ? <NewProductSheet onSaved={(product) => { setProducts((current) => [...current, product]); setNotice('Custom product saved.'); }} /> : null}
    </main>
  );
}
