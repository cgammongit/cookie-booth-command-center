"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  barcode: string;
  price: number;
  active: number;
  boothCount: number;
};

type Booth = {
  id: number;
  name: string;
  address: string;
  locationName: string | null;
  startsAt: string;
  status: string;
};

type Allocation = Product & {
  opening: number | null;
  sold: number | null;
  adjusted: number | null;
};

export function InventoryManagement({
  organizationId,
  organizationName,
  initialBoothId = null,
  onBack,
}: {
  organizationId: number;
  organizationName: string;
  initialBoothId?: number | null;
  onBack: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [selectedBoothId, setSelectedBoothId] = useState<number | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [boothQuery, setBoothQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editable, setEditable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({ name: "", barcode: "", price: "6" });
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", barcode: "", price: "" });

  const loadFoundation = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [productResponse, boothResponse] = await Promise.all([
        fetch(`/api/admin/products?organizationId=${organizationId}`, { cache: "no-store" }),
        fetch(`/api/booths?organizationId=${organizationId}`, { cache: "no-store" }),
      ]);
      const productPayload = await productResponse.json() as {
        products?: Product[];
        error?: string;
      };
      const boothPayload = await boothResponse.json() as {
        booths?: Booth[];
        error?: string;
      };
      if (!productResponse.ok) throw new Error(productPayload.error || "Unable to load products");
      if (!boothResponse.ok) throw new Error(boothPayload.error || "Unable to load booths");
      setProducts(productPayload.products || []);
      setBooths(boothPayload.booths || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load inventory");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/admin/products?organizationId=${organizationId}`, { cache: "no-store" }),
      fetch(`/api/booths?organizationId=${organizationId}`, { cache: "no-store" }),
    ])
      .then(async ([productResponse, boothResponse]) => {
        const productPayload = await productResponse.json() as {
          products?: Product[];
          error?: string;
        };
        const boothPayload = await boothResponse.json() as {
          booths?: Booth[];
          error?: string;
        };
        if (!productResponse.ok) throw new Error(productPayload.error || "Unable to load products");
        if (!boothResponse.ok) throw new Error(boothPayload.error || "Unable to load booths");
        if (active) {
          setProducts(productPayload.products || []);
          setBooths(boothPayload.booths || []);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load inventory");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  const loadAllocations = useCallback(async (boothId: number) => {
    setError("");
    try {
      const response = await fetch(
        `/api/admin/booth-inventory?organizationId=${organizationId}&boothId=${boothId}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as {
        inventory?: Allocation[];
        editable?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to load booth inventory");
      setAllocations(payload.inventory || []);
      setEditable(Boolean(payload.editable));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load booth inventory");
    }
  }, [organizationId]);

  useEffect(() => {
    if (
      initialBoothId &&
      selectedBoothId === null &&
      booths.some((booth) => booth.id === initialBoothId)
    ) {
      setSelectedBoothId(initialBoothId);
      void loadAllocations(initialBoothId);
    }
  }, [booths, initialBoothId, loadAllocations, selectedBoothId]);

  const visibleProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    return products.filter(
      (product) =>
        (showInactive || Boolean(product.active)) &&
        (!query ||
          product.name.toLowerCase().includes(query) ||
          product.barcode.toLowerCase().includes(query)),
    );
  }, [productQuery, products, showInactive]);

  const visibleBooths = useMemo(() => {
    const query = boothQuery.trim().toLowerCase();
    return booths.filter(
      (booth) =>
        !query ||
        booth.name.toLowerCase().includes(query) ||
        booth.address.toLowerCase().includes(query) ||
        booth.locationName?.toLowerCase().includes(query),
    );
  }, [boothQuery, booths]);

  async function createProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("create");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: draft.name,
          barcode: draft.barcode,
          price: Number(draft.price),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to create product");
      setDraft({ name: "", barcode: "", price: "6" });
      setNotice("Product added to the organization catalog.");
      await loadFoundation();
      if (selectedBoothId) await loadAllocations(selectedBoothId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create product");
    } finally {
      setSaving("");
    }
  }

  function beginEdit(product: Product) {
    setEditingProductId(product.id);
    setEditDraft({
      name: product.name,
      barcode: product.barcode,
      price: Number(product.price).toFixed(2),
    });
    setError("");
    setNotice("");
  }

  async function saveProductEdit(event: React.FormEvent<HTMLFormElement>, product: Product) {
    event.preventDefault();
    setSaving(`edit:${product.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: editDraft.name,
          barcode: editDraft.barcode,
          price: Number(editDraft.price),
          active: Boolean(product.active),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to update product");
      setEditingProductId(null);
      setNotice("Product details updated with an audit record.");
      await loadFoundation();
      if (selectedBoothId) await loadAllocations(selectedBoothId);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update product");
    } finally {
      setSaving("");
    }
  }

  async function toggleProduct(product: Product) {
    setSaving(`product:${product.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: product.name,
          barcode: product.barcode,
          price: Number(product.price),
          active: !Boolean(product.active),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to update product");
      setNotice(`${product.name} is now ${product.active ? "inactive" : "active"}.`);
      await loadFoundation();
      if (selectedBoothId) await loadAllocations(selectedBoothId);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update product");
    } finally {
      setSaving("");
    }
  }

  function updateOpening(productId: number, value: string) {
    setAllocations((current) =>
      current.map((item) =>
        item.id === productId
          ? { ...item, opening: value === "" ? null : Math.max(0, Number(value)) }
          : item,
      ),
    );
  }

  async function saveInventory() {
    if (!selectedBoothId) return;
    setSaving("inventory");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/booth-inventory", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          boothId: selectedBoothId,
          allocations: allocations
            .filter((item) => Boolean(item.active) && item.opening !== null)
            .map((item) => ({ productId: item.id, opening: Number(item.opening) })),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to save inventory");
      setNotice("Opening inventory saved with an audit record.");
      await loadAllocations(selectedBoothId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save inventory");
    } finally {
      setSaving("");
    }
  }

  const selectedBooth = booths.find((booth) => booth.id === selectedBoothId);

  return (
    <main>
      <header>
        <button className="back" onClick={onBack}>← Command center</button>
        <div className="brand">COOKIE BOOTH <b>COMMAND CENTER</b></div>
        <span className="roleBadge">ADMIN</span>
      </header>
      <section className="peopleHero">
        <div>
          <p className="eyebrow">INVENTORY CONTROL · {organizationName}</p>
          <h1>Products & inventory</h1>
          <p>Maintain one product catalog and configure opening counts booth by booth.</p>
        </div>
        <div className="peopleSummary">
          <strong>{products.filter((product) => Boolean(product.active)).length}</strong>
          <span>active products</span>
        </div>
      </section>
      {error && <div className="alert errorAlert" role="alert">{error}</div>}
      {notice && <div className="alert successAlert" role="status">{notice}</div>}

      <section className="peoplePanel">
        <div className="panelHeading">
          <div><p className="eyebrow">ORGANIZATION CATALOG</p><h2>Add a cookie product</h2></div>
        </div>
        <form className="productForm" onSubmit={(event) => void createProduct(event)}>
          <label>Name<input required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Barcode<input required maxLength={80} value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></label>
          <label>Price<input required min="0.01" max="100" step="0.01" type="number" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></label>
          <button className="primary" disabled={saving === "create"}>{saving === "create" ? "Adding…" : "Add product"}</button>
        </form>
        <div className="catalogFilters">
          <input type="search" placeholder="Search product or barcode" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
          <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive</label>
        </div>
        <div className="catalogList">
          {visibleProducts.map((product) => (
            <article key={product.id} className={product.active ? "" : "inactive"}>
              <div><strong>{product.name}</strong><small>{product.barcode}</small></div>
              <span>${Number(product.price).toFixed(2)}</span>
              <span>{product.boothCount} booth{Number(product.boothCount) === 1 ? "" : "s"}</span>
              <div className="catalogActions">
                <button onClick={() => beginEdit(product)}>Edit</button>
                <button disabled={saving === `product:${product.id}`} onClick={() => void toggleProduct(product)}>
                  {product.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
              {editingProductId === product.id && (
                <form className="productEditForm" onSubmit={(event) => void saveProductEdit(event, product)}>
                  <label>Name<input required maxLength={100} value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} /></label>
                  <label>Barcode<input required maxLength={80} value={editDraft.barcode} onChange={(event) => setEditDraft({ ...editDraft, barcode: event.target.value })} /></label>
                  <label>Price<input required min="0.01" max="100" step="0.01" type="number" value={editDraft.price} onChange={(event) => setEditDraft({ ...editDraft, price: event.target.value })} /></label>
                  <div className="catalogActions">
                    <button type="button" onClick={() => setEditingProductId(null)}>Cancel</button>
                    <button className="saveAccess" disabled={saving === `edit:${product.id}`}>{saving === `edit:${product.id}` ? "Saving…" : "Save changes"}</button>
                  </div>
                </form>
              )}
            </article>
          ))}
          {!loading && !visibleProducts.length && <div className="loadingState">No products match this view.</div>}
        </div>
      </section>

      <section className="managementLayout inventoryAdminLayout">
        <div className="peoplePanel boothDirectoryPanel">
          <div className="panelHeading">
            <div><p className="eyebrow">BOOTH DIRECTORY</p><h2>Select a booth</h2></div>
          </div>
          <div className="managementFilters single">
            <input type="search" placeholder="Search booth or location" value={boothQuery} onChange={(event) => setBoothQuery(event.target.value)} />
          </div>
          <div className="managedBoothList">
            {visibleBooths.map((booth) => (
              <button
                className={booth.id === selectedBoothId ? "selected" : ""}
                key={booth.id}
                onClick={() => {
                  setSelectedBoothId(booth.id);
                  setNotice("");
                  void loadAllocations(booth.id);
                }}
              >
                <span className={`pill ${booth.status}`}>{booth.status}</span>
                <strong>{booth.name}</strong>
                <small>{booth.locationName || booth.address}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="peoplePanel allocationPanel">
          <div className="panelHeading">
            <div>
              <p className="eyebrow">OPENING COUNTS</p>
              <h2>{selectedBooth?.name || "Select a booth"}</h2>
            </div>
            {selectedBooth && (
              <button className="saveAccess" disabled={!editable || saving === "inventory"} onClick={() => void saveInventory()}>
                {saving === "inventory" ? "Saving…" : "Save inventory"}
              </button>
            )}
          </div>
          {!selectedBooth ? (
            <div className="loadingState">Choose a booth to configure its product allocation.</div>
          ) : (
            <>
              {!editable && <div className="alert policyAlert">Closed and archived inventory is retained as read-only history.</div>}
              <div className="allocationList">
                {allocations.filter((item) => Boolean(item.active) || item.opening !== null).map((item) => (
                  <label key={item.id} className={item.active ? "" : "inactive"}>
                    <span><strong>{item.name}</strong><small>{item.barcode} · ${Number(item.price).toFixed(2)}</small></span>
                    <input
                      aria-label={`${item.name} opening count`}
                      disabled={!editable || !item.active || Number(item.sold || 0) !== 0 || Number(item.adjusted || 0) !== 0}
                      min="0"
                      max="10000"
                      type="number"
                      placeholder="Not allocated"
                      value={item.opening ?? ""}
                      onChange={(event) => updateOpening(item.id, event.target.value)}
                    />
                    <small>
                      {Number(item.sold || 0) || Number(item.adjusted || 0)
                        ? `${item.sold || 0} sold · ${item.adjusted || 0} adjusted`
                        : item.opening === null ? "Not at this booth" : "Ready to open"}
                    </small>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
      <aside><b>Audit boundary</b><span>Catalog records are deactivated rather than deleted. Every saved booth allocation records its before-and-after state.</span></aside>
    </main>
  );
}
