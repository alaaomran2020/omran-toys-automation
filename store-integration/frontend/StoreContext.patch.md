# StoreContext.jsx — changes (2 small additions, nothing removed)

File: `src/context/StoreContext.jsx`

## 1. Import (top of file, with the other imports)

```jsx
import { fetchRemoteProducts } from '../lib/storeApi';
```

## 2. Two new `useEffect`s inside `StoreProvider`

Place them right after the existing "Sync localStorage" block
(the series of `useEffect(() => { localStorage.setItem(...` lines).

```jsx
  // Load products published via the automation system (safe fallback:
  // if the API is unavailable, the local catalog is used as before).
  useEffect(() => {
    let cancelled = false;
    fetchRemoteProducts().then((remote) => {
      if (cancelled || !remote) return;
      setProducts((prev) => {
        const prevIds = new Set(prev.map((p) => String(p.id)));
        const fresh = remote.filter((p) => !prevIds.has(String(p.id)));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link: open a product from #product=<id> (sent by the automation bot)
  useEffect(() => {
    const match = window.location.hash.match(/product=([\w-]+)/);
    if (!match) return;
    const target = products.find((p) => String(p.id) === match[1]);
    if (target) {
      setSelectedProductModal(target);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [products]);
```

### Why this is safe
- The API is fetched with a 4-second timeout and **any failure is silent** —
  the store behaves exactly as today when the Worker is down or not deployed.
- Remote products are **merged by id** (duplicates impossible).
- The deep-link effect only acts when `#product=<id>` is present in the URL;
  normal navigation is untouched.
- No UI changes, no checkout changes, no auth changes.
