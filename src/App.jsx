import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ClipboardList,
  Droplets,
  KeyRound,
  LayoutDashboard,
  UsersRound,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import logo from "./assets/logo.webp";
import { supabase } from "./lib/supabaseClient";
import AuthPage from "./components/AuthPage";
import ConfirmModal from "./components/ConfirmModal";
import { buildDefaultPricing } from "./data/pricing";
import * as db from "./lib/db";
import { accessFor, isSalesWorker, ROLE_LABELS } from "./lib/access";

// Each page is a separate download, fetched the first time it is needed and
// prefetched once the login's role is known. A worker's phone never
// downloads the dashboard and its charts library.
const loadPage = {
  form: () => import("./components/WorkerForm"),
  dashboard: () => import("./components/AdminDashboard"),
  records: () => import("./components/SalesRecords"),
  workers: () => import("./components/WorkerManagement"),
  logins: () => import("./components/LoginsManagement"),
  services: () => import("./components/ServicesManagement"),
};

const WorkerForm = lazy(loadPage.form);
const AdminDashboard = lazy(loadPage.dashboard);
const SalesRecords = lazy(loadPage.records);
const WorkerManagement = lazy(loadPage.workers);
const LoginsManagement = lazy(loadPage.logins);
const ServicesManagement = lazy(loadPage.services);

/*
 * A page's code can fail to download: a dropped connection, or a deploy that
 * replaced the files since this tab was opened. Offer a reload instead of a
 * blank screen. This also catches a page that crashes while drawing.
 */
class PageErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="form-card">
        <h2>This page could not load</h2>
        <p>Check the connection, then reload.</p>
        <button
          type="button"
          className="submit-btn"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

// Only kept so a device that still holds records from before the database
// cutover can hand them over once; see the import banner below.
const LOCAL_KEYS = {
  orders: "mk4-auto-care-orders",
  workers: "mk4-auto-care-workers",
};


// Starter profiles for a brand new shop. Deliberately minimal: the roles are
// a guess and the shop is expected to delete these once its own staff are in.
const INITIAL_WORKERS = [
  {
    name: "Millet",
    role: "Admin",
    status: "Active",
    commissionMode: "inherit",
    commissionValue: 0,
    notes: "Starter profile. Replace with the shop's own staff.",
  },
  {
    name: "Angelica",
    role: "Worker",
    status: "Active",
    commissionMode: "inherit",
    commissionValue: 0,
    notes: "Starter profile. Replace with the shop's own staff.",
  },
];

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

const defaultCommissionSettings = {
  globalMode: "service_percent",
  globalValue: "100",
};

const EMPTY_PRICING = { categories: [], addOns: [] };

// Sidebar order. Each login sees the entries its role allows (lib/access).
// short: the label under the icon in the phone's bottom bar.
const NAV = [
  { page: "form", label: "Worker Form", short: "Form", icon: ClipboardList },
  { page: "dashboard", label: "Admin Dashboard", short: "Dashboard", icon: LayoutDashboard },
  { page: "records", label: "Sales Records", short: "Sales", icon: BarChart3 },
  { page: "workers", label: "Employees", short: "Employees", icon: UsersRound },
  { page: "logins", label: "Logins", short: "Logins", icon: KeyRound },
  { page: "services", label: "Services", short: "Services", icon: Droplets },
  { page: "login", label: "Login", short: "Login", icon: LogIn },
];

const PAGE_TITLES = {
  form: "Worker Carwash Entry",
  dashboard: "Admin Analytics Dashboard",
  records: "Sales Order Records",
  workers: "Employees and Commission",
  logins: "Staff Logins",
  services: "Services and Pricing",
  login: "Staff Login",
};



export default function App() {
  // The page asked for. What is shown is this if the login may open it, or
  // its role's home page otherwise (see currentPage below).
  const [activePage, setActivePage] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // The phone layout's menu: who is signed in, and Logout.
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [orders, setOrders] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [commissionSettings, setCommissionSettings] = useState(
    defaultCommissionSettings
  );
  const [pricing, setPricing] = useState(EMPTY_PRICING);

  // Who is signed in and what they may open, tagged with the session it was
  // loaded for, so a fresh login never runs on the previous visitor's access.
  const [accessState, setAccessState] = useState({ key: null, access: null });

  // Strict Mode runs effects twice in development, and the second run would
  // seed a second price list with freshly generated ids. Load once per session.
  const loadedForSession = useRef(null);

  // The id set that is currently stored, so a save can tell a real deletion
  // from a price list that simply has not finished loading.
  const savedPricingIds = useRef(null);

  // The price list and commission rule last known to match the database.
  // Loading sets them, so a load is not written straight back: before this,
  // every admin page load rewrote all 112 price rows and the commission rule
  // unchanged. Only an edit on the Services or Employees page is saved.
  const storedPricing = useRef(null);
  const storedCommission = useRef(null);

  // idle (signed out) | loading | ready | error
  const [dataState, setDataState] = useState("idle");
  const [dataError, setDataError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [archivedOrders, setArchivedOrders] = useState([]);
  const [importOffer, setImportOffer] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Each login loads only what its role can open (lib/access). Before the
  // roles migration, the public Worker Form still loads its staff list,
  // price list and commission rule signed out.
  useEffect(() => {
    const sessionKey = session?.user?.id || "public";

    // Guards against Strict Mode's double invocation seeding twice.
    if (loadedForSession.current === sessionKey) return undefined;
    loadedForSession.current = sessionKey;

    // No cancellation flag here on purpose. Strict Mode tears this effect
    // down right after its first run, and the ref guard above stops the
    // second run from starting another load -- so cancelling the first would
    // leave nothing to finish and the app stuck on "Loading records". A
    // stray setState after a real unmount is a harmless no-op.
    async function load() {
      setDataState("loading");
      setDataError("");

      try {
        const nextAccess = await db.fetchAccess();
        const can = accessFor(nextAccess, Boolean(session));

        // Seeding writes, which only an admin may do.
        if (can.seed) {
          if (await db.isPricingEmpty()) {
            await db.seedPricing(buildDefaultPricing());
          }

          await db.seedWorkers(INITIAL_WORKERS);
        }

        const [
          nextWorkers,
          nextCommission,
          nextPricing,
          nextOrders,
          nextArchived,
        ] = await Promise.all([
            can.loadWorkers === "mine"
              ? db.fetchMyEmployees()
              : can.loadWorkers
                ? db.fetchWorkers({ publicOnly: can.loadWorkers === "public" })
                : [],
            can.loadCommission
              ? db.fetchCommissionSettings()
              : defaultCommissionSettings,
            can.loadPricing ? db.fetchPricing() : EMPTY_PRICING,
            can.loadOrders ? db.fetchOrders() : [],
            // Archived sales are out of every total; they are only loaded so
            // the Archived view can show them and put one back.
            can.loadOrders ? db.fetchArchivedOrders() : [],
          ]);

        setAccessState({ key: sessionKey, access: nextAccess });
        setOrders(nextOrders);
        setArchivedOrders(nextArchived);
        setWorkers(nextWorkers);
        setCommissionSettings(nextCommission);
        setPricing(nextPricing);
        storedCommission.current = nextCommission;
        storedPricing.current = nextPricing;
        savedPricingIds.current = db.collectPricingIds(nextPricing);
        setDataState("ready");
        setImportOffer(
          can.seed && !nextWorkers.length && db.hasLocalData(LOCAL_KEYS)
        );
      } catch (error) {
        console.error("Could not load data", error);
        setDataError(error.message || "Could not load data.");
        setDataState("error");
      }
    }

    load();

    return undefined;
  }, [session]);

  const isLoggedIn = Boolean(session);
  const sessionKey = session?.user?.id || "public";
  const access = accessState.key === sessionKey ? accessState.access : null;
  const can = accessFor(access, isLoggedIn);
  const currentPage = can.pages.includes(activePage) ? activePage : can.home;
  const { editPricing, editCommission } = can;
  const pagesKey = can.pages.join(",");
  const navItems = NAV.filter((item) => can.pages.includes(item.page));
  // A bottom bar with one button goes nowhere, so a worker's phone has none.
  const hasBottomNav = navItems.length > 1;

  useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  // Fetch the code for this login's pages in the background, so opening one
  // later is instant. The browser caches each one after the first time.
  useEffect(() => {
    pagesKey
      .split(",")
      .forEach((page) => loadPage[page]?.().catch(() => undefined));
  }, [pagesKey]);

  // The Services page reports every keystroke, so writes are debounced.
  useEffect(() => {
    if (!editPricing || dataState !== "ready") return undefined;
    if (pricing === storedPricing.current) return undefined;

    const timer = setTimeout(() => {
      db
        .savePricing(pricing, savedPricingIds.current)
        .then(() => {
          storedPricing.current = pricing;
          savedPricingIds.current = db.collectPricingIds(pricing);
          setSaveError("");
        })
        .catch((error) => {
          console.error("Could not save the price list", error);
          setSaveError(`Price list not saved: ${error.message}`);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [pricing, dataState, editPricing]);

  useEffect(() => {
    if (!editCommission || dataState !== "ready") return undefined;
    if (commissionSettings === storedCommission.current) return undefined;

    const timer = setTimeout(() => {
      db
        .saveCommissionSettings(commissionSettings)
        .then(() => {
          storedCommission.current = commissionSettings;
          setSaveError("");
        })
        .catch((error) => {
          console.error("Could not save commission settings", error);
          setSaveError(`Commission settings not saved: ${error.message}`);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [commissionSettings, dataState, editCommission]);

  async function runImport() {
    setImporting(true);

    try {
      const summary = await db.importLocalStorage(LOCAL_KEYS);

      const [nextOrders, nextWorkers] = await Promise.all([
        db.fetchOrders(),
        db.fetchWorkers(),
      ]);

      setOrders(nextOrders);
      setWorkers(nextWorkers);
      setImportOffer(false);

      alert(
        `Imported ${summary.workers} worker(s) and ${summary.orders} order(s) into the shared database.`
      );
    } catch (error) {
      console.error("Import failed", error);
      alert(
        `Could not import this device's records: ${error.message}\n\nNothing was removed from this browser.`
      );
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function getSession() {
      const { data } = await supabase.auth.getSession();

      if (isMounted) {
        setSession(data.session);
        setAuthChecked(true);
      }
    }

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setAuthChecked(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function addOrder(order) {
    // Add-on rows store their price, which only the current price list knows.
    const addOnPrices = {};
    (pricing.addOns || []).forEach((addOn) => {
      addOnPrices[addOn.name] = addOn.price;
    });

    const saved = await db.createOrder({ ...order, addOnPrices });

    setOrders((prev) => [saved, ...prev]);

    // Before roles, a signed-in user went on to the dashboard. A worker,
    // signed in or not, stays on the form for the next car.
    if (session && !access?.installed) setActivePage("dashboard");

    return saved;
  }

  
  async function updateOrderPayment(orderId, paymentUpdate) {
    const existing = orders.find((order) => order.id === orderId);
    if (!existing) return;

    const discount = paymentUpdate.paymentEnabled?.discount
      ? Number(paymentUpdate.discount) || 0
      : 0;

    const total = Math.max(
      Number(existing.serviceTotal || 0) +
        Number(existing.addOnTotal || 0) -
        discount,
      0
    );

    const totalPaid =
      (paymentUpdate.paymentEnabled?.cash ? Number(paymentUpdate.cash) || 0 : 0) +
      (paymentUpdate.paymentEnabled?.gcash ? Number(paymentUpdate.gcash) || 0 : 0) +
      (paymentUpdate.paymentEnabled?.credit
        ? Number(paymentUpdate.credit) || 0
        : 0) +
      (paymentUpdate.paymentEnabled?.bank ? Number(paymentUpdate.bank) || 0 : 0);

    try {
      const saved = await db.updateOrderPayment(existing.dbId, {
        ...paymentUpdate,
        total,
        totalPaid,
        balance: total - totalPaid,
      });

      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? saved : order))
      );
    } catch (error) {
      console.error("Could not update the payment", error);
      alert(`Could not update the payment: ${error.message}`);
    }
  }

  async function addWorker(worker) {
    try {
      const saved = await db.createWorker(worker);
      setWorkers((prev) => [saved, ...prev]);
    } catch (error) {
      console.error("Could not add the employee", error);
      alert(`Could not add the employee: ${error.message}`);
    }
  }

  async function updateWorker(workerId, updatedWorker) {
    const existing = workers.find((worker) => worker.id === workerId);

    try {
      const saved = await db.updateWorker(workerId, {
        ...existing,
        ...updatedWorker,
      });

      setWorkers((prev) =>
        prev.map((worker) => (worker.id === workerId ? saved : worker))
      );
    } catch (error) {
      console.error("Could not update the employee", error);
      alert(`Could not update the employee: ${error.message}`);
    }
  }

  // After the Logins page moves an employee onto a login, so the Employees
  // page shows their new Login Email.
  async function refreshWorkers() {
    try {
      setWorkers(await db.fetchWorkers());
    } catch (error) {
      console.error("Could not reload the employees", error);
    }
  }

  function deleteWorker(workerId) {
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return;

    // The sales are kept (21): the foreign key only clears worker_id, and
    // worker_name is plain text, so they stay in the records under the name of
    // whoever did the car. Say so plainly, with the figures.
    const theirOrders = orders.filter((order) => order.workerId === workerId);
    const takings = theirOrders.reduce(
      (sum, order) => sum + Number(order.total || 0),
      0
    );

    setPendingDelete({
      kind: "worker",
      id: workerId,
      title: `Delete ${worker.name}?`,
      message: theirOrders.length
        ? `${worker.name}'s sales are kept. They stay in the records and in every total under their name; only the link to this employee profile goes. Your figures do not change.`
        : `${worker.name} has no sales recorded. Deleting the employee removes nothing else.`,
      details: theirOrders.length
        ? [
            `${theirOrders.length} sales order(s) will be kept`,
            `${peso.format(takings)} of recorded sales is unaffected`,
            "Their payment proof images are kept",
            "They stop counting towards any employee on the Employees page",
            "To keep the link as well, cancel and set them to Inactive",
          ]
        : [],
      confirmLabel: "Delete employee",
    });
  }

  function archiveOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    setPendingDelete({
      kind: "order",
      id: orderId,
      title: `Archive ${order.id}?`,
      message:
        "This takes the sale out of the records and out of every report and total. Nothing is deleted: the sale, its services and its payment proof are all kept and can be put back from the Archived view.",
      details: [
        `${order.plateNumber || "No plate"} on ${order.date}`,
        `${peso.format(Number(order.total || 0))} total, ${peso.format(
          Number(order.totalPaid || 0)
        )} paid`,
        order.washerName ? `Recorded by ${order.washerName}` : null,
      ].filter(Boolean),
      confirmLabel: "Archive sale",
      reversible: true,
    });
  }

  async function restoreOrder(orderId) {
    const order = archivedOrders.find((item) => item.id === orderId);
    if (!order) return;

    try {
      const restored = await db.restoreOrder(order.dbId);

      setArchivedOrders((prev) =>
        prev.filter((item) => item.id !== orderId)
      );
      setOrders((prev) => [restored, ...prev]);
    } catch (error) {
      console.error("Could not restore the sale", error);
      alert(`Could not put that sale back: ${error.message}`);
    }
  }

  async function confirmPendingDelete() {
    if (!pendingDelete) return;

    setIsDeleting(true);

    let proofPaths;

    try {
      if (pendingDelete.kind === "worker") {
        // Nothing to clean up: the sales stay, so their proofs stay too.
        proofPaths = [];

        await db.deleteWorker(pendingDelete.id);
        setWorkers((prev) =>
          prev.filter((worker) => worker.id !== pendingDelete.id)
        );

        // The database cleared worker_id on their sales; mirror that here so
        // the Employees totals stop counting them without a reload.
        const unlink = (list) =>
          list.map((order) =>
            order.workerId === pendingDelete.id
              ? { ...order, workerId: "" }
              : order
          );

        setOrders(unlink);
        setArchivedOrders(unlink);
      } else {
        const order = orders.find((item) => item.id === pendingDelete.id);

        // Archiving keeps the proof image: the sale can come back, and it
        // would come back without its evidence.
        proofPaths = [];

        const archived = await db.archiveOrder(order.dbId, access?.name || null);

        setOrders((prev) =>
          prev.filter((item) => item.id !== pendingDelete.id)
        );
        setArchivedOrders((prev) => [archived, ...prev]);
      }

      setPendingDelete(null);
    } catch (error) {
      console.error("Could not complete the delete", error);
      alert(`Could not delete that: ${error.message}`);
      setIsDeleting(false);
      return;
    }

    // The sales are already gone, so a proof that fails to delete only costs
    // storage. Logged rather than reported as a failed delete.
    try {
      await db.removeProofs(proofPaths);
    } catch (error) {
      console.error("Could not delete the payment proof images", error);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setActivePage(null);

    // Do not leave another user's records on screen behind the login wall.
    setOrders([]);
    setArchivedOrders([]);
    setWorkers([]);
    setDataState("idle");
    setImportOffer(false);
    // Forces the effect to re-run and reload the public half of the data.
    loadedForSession.current = null;
    savedPricingIds.current = null;
  }

  function goToPage(page) {
    setActivePage(page);
  }

  // The bottom bar switches pages like a phone app: each opens at its top.
  function goToPageFromBottomBar(page) {
    setActivePage(page);
    window.scrollTo(0, 0);
  }

  function logoutFromMenu() {
    setMenuOpen(false);
    handleLogout();
  }

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${
        hasBottomNav ? " has-bottom-nav" : ""
      }`}
    >
      {dataState === "loading" && (
        <div className="data-banner">Loading records…</div>
      )}

      {dataState === "error" && (
        <div className="data-banner is-error">
          Could not reach the database: {dataError}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete.title}
          message={pendingDelete.message}
          details={pendingDelete.details}
          confirmLabel={pendingDelete.confirmLabel}
          reversible={Boolean(pendingDelete.reversible)}
          isBusy={isDeleting}
          onConfirm={confirmPendingDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {saveError && <div className="data-banner is-error">{saveError}</div>}

      {importOffer && (
        <div className="data-banner is-action">
          This browser still holds records from before the shared database.
          <button type="button" onClick={runImport} disabled={importing}>
            {importing ? "Importing…" : "Import them now"}
          </button>
        </div>
      )}

      <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-logo-wrap">
              <img src={logo} alt="MK4 Auto Care" />
            </div>
            <div className="brand-text">
              <h1>MK4 Auto Care</h1>
              <p>Carwash Point of Sale</p>
            </div>
          </div>

          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>

        <nav>
          {navItems.map(
            ({ page, label, icon: Icon }) => (
              <button
                key={page}
                className={currentPage === page ? "active" : ""}
                onClick={() => goToPage(page)}
                title={label}
              >
                <Icon size={18} />
                <span className="nav-label">{label}</span>
              </button>
            )
          )}
        </nav>

        {isLoggedIn && access?.installed && access.role && (
          <div className="signed-in-as nav-label">
            {access.name}
            <span>{ROLE_LABELS[access.role]}</span>
          </div>
        )}

        {isLoggedIn && (
          <button className="logout-btn" onClick={handleLogout} title="Logout">
            <LogOut size={18} />
            <span className="nav-label">Logout</span>
          </button>
        )}
      </aside>

      {/* Phones and small tablets: this header, the bottom bar and the menu
          replace the sidebar (styles.css, max-width 900px). */}
      <header className="mobile-header">
        {isLoggedIn && (
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            <Menu size={22} />
          </button>
        )}

        <img src={logo} alt="MK4 Auto Care" className="mobile-header-logo" />

        <div className="mobile-header-title">
          <span>MK4 Auto Care</span>
          <strong>{PAGE_TITLES[currentPage] || "Carwash Point of Sale"}</strong>
        </div>
      </header>

      {hasBottomNav && (
        <nav className="bottom-nav" aria-label="Pages">
          {navItems.map(({ page, short, icon: Icon }) => (
            <button
              key={page}
              type="button"
              className={currentPage === page ? "active" : ""}
              aria-current={currentPage === page ? "page" : undefined}
              onClick={() => goToPageFromBottomBar(page)}
            >
              <Icon size={21} />
              <span>{short}</span>
            </button>
          ))}
        </nav>
      )}

      {menuOpen && isLoggedIn && (
        <div className="mobile-drawer-backdrop" onClick={() => setMenuOpen(false)}>
          <aside
            className="mobile-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="mobile-drawer-top">
              <div className="brand">
                <div className="brand-logo-wrap">
                  <img src={logo} alt="MK4 Auto Care" />
                </div>
                <div className="brand-text">
                  <h1>MK4 Auto Care</h1>
                  <p>Carwash Point of Sale</p>
                </div>
              </div>

              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            {access?.installed && access.role && (
              <div className="signed-in-as">
                {access.name}
                <span>{ROLE_LABELS[access.role]}</span>
              </div>
            )}

            <button type="button" className="logout-btn" onClick={logoutFromMenu}>
              <LogOut size={18} />
              Logout
            </button>
          </aside>
        </div>
      )}

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">MK4 POS</span>
            <h2>{PAGE_TITLES[currentPage] || "MK4 Auto Care"}</h2>
          </div>
        </header>

        {(!authChecked || (!access && dataState !== "error")) && (
          <div className="form-card">
            <h2>Checking access...</h2>
          </div>
        )}

        {authChecked && access && isLoggedIn && !can.pages.length && (
          <div className="form-card">
            <h2>No access yet</h2>
            <p>
              This login is not linked to an active employee. Ask an admin to
              put your login email on your profile on the Employees page, then
              log in again.
            </p>
          </div>
        )}

        {currentPage === "login" && (
          <AuthPage onLoginSuccess={(newSession) => setSession(newSession)} />
        )}

        {/* key: a failed page does not keep the next one from loading */}
        <PageErrorBoundary key={currentPage}>
          <Suspense
            fallback={
              <div className="form-card">
                <h2>Loading...</h2>
              </div>
            }
          >
            {currentPage === "form" && (
              <WorkerForm
                /*
                 * The form builds its first blank service row from the price list,
                 * which now arrives asynchronously. Keying on whether that list
                 * has loaded remounts the form once it does, so Package / Size is
                 * never left empty because the data was a moment late.
                 */
                key={pricing.categories.length ? "priced" : "empty"}
                onAddOrder={addOrder}
                // A secretary's list holds every employee; the form offers
                // only workers. A worker login's list is workers already.
                workers={workers.filter(isSalesWorker)}
                chooseWorkerLabel={
                  access?.role === "secretary"
                    ? "Select the worker"
                    : "Select your name"
                }
                commissionSettings={commissionSettings}
                pricingData={pricing.categories}
                addOns={pricing.addOns}
              />
            )}

            {currentPage === "dashboard" && (
              <AdminDashboard orders={orders} workers={workers} />
            )}

            {currentPage === "records" && (
              <SalesRecords
                orders={orders}
                workers={workers}
                archivedOrders={archivedOrders}
                onUpdateOrderPayment={updateOrderPayment}
                onArchiveOrder={archiveOrder}
                onRestoreOrder={restoreOrder}
              />
            )}

            {currentPage === "services" && (
              <ServicesManagement pricing={pricing} onUpdatePricing={setPricing} />
            )}

            {currentPage === "workers" && (
              <WorkerManagement
                workers={workers}
                orders={orders}
                onAddWorker={addWorker}
                onUpdateWorker={updateWorker}
                onDeleteWorker={deleteWorker}
                commissionSettings={commissionSettings}
                onUpdateCommissionSettings={setCommissionSettings}
                rolesOn={Boolean(access?.installed)}
                manageAdmins={can.manageAdmins}
              />
            )}

            {currentPage === "logins" && (
              <LoginsManagement
                currentUserId={session?.user?.id}
                onSignedOutSelf={handleLogout}
                onEmployeesChanged={refreshWorkers}
              />
            )}
          </Suspense>
        </PageErrorBoundary>
      </main>
    </div>
  );
}