import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ClipboardList,
  Droplets,
  LayoutDashboard,
  UsersRound,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import WorkerForm from "./components/WorkerForm";
import AdminDashboard from "./components/AdminDashboard";
import SalesRecords from "./components/SalesRecords";
import WorkerManagement from "./components/WorkerManagement";
import ServicesManagement from "./components/ServicesManagement";
import logo from "./assets/logo.png";
import { supabase } from "./lib/supabaseClient";
import AuthPage from "./components/AuthPage";
import ConfirmModal from "./components/ConfirmModal";
import { buildDefaultPricing } from "./data/pricing";
import * as db from "./lib/db";
import { accessFor, ROLE_LABELS } from "./lib/access";

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
const NAV = [
  { page: "form", label: "Worker Form", icon: ClipboardList },
  { page: "dashboard", label: "Admin Dashboard", icon: LayoutDashboard },
  { page: "records", label: "Sales Records", icon: BarChart3 },
  { page: "workers", label: "Employees", icon: UsersRound },
  { page: "services", label: "Services", icon: Droplets },
  { page: "login", label: "Login", icon: LogIn },
];

const PAGE_TITLES = {
  form: "Worker Carwash Entry",
  dashboard: "Admin Analytics Dashboard",
  records: "Sales Order Records",
  workers: "Employees and Commission",
  services: "Services and Pricing",
  login: "Staff Login",
};



export default function App() {
  // The page asked for. What is shown is this if the login may open it, or
  // its role's home page otherwise (see currentPage below).
  const [activePage, setActivePage] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

        const [nextWorkers, nextCommission, nextPricing, nextOrders] =
          await Promise.all([
            can.loadWorkers
              ? db.fetchWorkers({ publicOnly: can.loadWorkers === "public" })
              : [],
            can.loadCommission
              ? db.fetchCommissionSettings()
              : defaultCommissionSettings,
            can.loadPricing ? db.fetchPricing() : EMPTY_PRICING,
            can.loadOrders ? db.fetchOrders() : [],
          ]);

        setAccessState({ key: sessionKey, access: nextAccess });
        setOrders(nextOrders);
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
        : 0);

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

  function deleteWorker(workerId) {
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return;

    // The foreign key cascades, so the worker's sales go too. Put the count
    // and the value on screen rather than asking them to take it on trust.
    const theirOrders = orders.filter((order) => order.workerId === workerId);
    const takings = theirOrders.reduce(
      (sum, order) => sum + Number(order.total || 0),
      0
    );
    const proofCount = theirOrders.filter((order) => order.photoPath).length;

    setPendingDelete({
      kind: "worker",
      id: workerId,
      title: `Delete ${worker.name}?`,
      message: theirOrders.length
        ? `${worker.name} has sales recorded against them. Deleting this profile deletes those sales as well, and your totals for those days will change.`
        : `${worker.name} has no sales recorded. Deleting the employee removes nothing else.`,
      details: theirOrders.length
        ? [
            `${theirOrders.length} sales order(s) will be deleted`,
            `${peso.format(takings)} of recorded sales will be removed`,
            proofCount
              ? `${proofCount} payment proof image(s) will be deleted`
              : null,
            "To keep the history instead, cancel and set them to Inactive",
          ].filter(Boolean)
        : [],
      confirmLabel: "Delete employee",
    });
  }

  function deleteOrder(orderId) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;

    setPendingDelete({
      kind: "order",
      id: orderId,
      title: `Delete ${order.id}?`,
      message:
        "This removes the sale from the records and from every report and total.",
      details: [
        `${order.plateNumber || "No plate"} on ${order.date}`,
        `${peso.format(Number(order.total || 0))} total, ${peso.format(
          Number(order.totalPaid || 0)
        )} paid`,
        order.washerName ? `Recorded by ${order.washerName}` : null,
        order.photoPath ? "Its payment proof image is deleted too" : null,
      ].filter(Boolean),
      confirmLabel: "Delete sale",
    });
  }

  async function confirmPendingDelete() {
    if (!pendingDelete) return;

    setIsDeleting(true);

    let proofPaths;

    try {
      if (pendingDelete.kind === "worker") {
        proofPaths = orders
          .filter((order) => order.workerId === pendingDelete.id)
          .map((order) => order.photoPath);

        await db.deleteWorker(pendingDelete.id);
        setWorkers((prev) =>
          prev.filter((worker) => worker.id !== pendingDelete.id)
        );
        // Their sales went with them in the database; mirror that here.
        setOrders((prev) =>
          prev.filter((order) => order.workerId !== pendingDelete.id)
        );
      } else {
        const order = orders.find((item) => item.id === pendingDelete.id);
        proofPaths = [order.photoPath];

        await db.deleteOrder(order.dbId);
        setOrders((prev) =>
          prev.filter((item) => item.id !== pendingDelete.id)
        );
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
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
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
          {NAV.filter((item) => can.pages.includes(item.page)).map(
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
            workers={workers}
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
            onUpdateOrderPayment={updateOrderPayment}
            onDeleteOrder={deleteOrder}
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
      </main>
    </div>
  );
}