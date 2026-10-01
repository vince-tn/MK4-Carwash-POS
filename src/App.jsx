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
import { buildDefaultPricing } from "./data/pricing";
import * as db from "./lib/db";

// Only kept so a device that still holds records from before the database
// cutover can hand them over once; see the import banner below.
const LOCAL_KEYS = {
  orders: "mk4-auto-care-orders",
  workers: "mk4-auto-care-workers",
};


const defaultCommissionSettings = {
  globalMode: "service_percent",
  globalValue: "100",
};



export default function App() {
  const [activePage, setActivePage] = useState("form");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [orders, setOrders] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [commissionSettings, setCommissionSettings] = useState(
    defaultCommissionSettings
  );
  const [pricing, setPricing] = useState({ categories: [], addOns: [] });

  // Strict Mode runs effects twice in development, and the second run would
  // seed a second price list with freshly generated ids. Load once per session.
  const loadedForSession = useRef(null);

  // The id set that is currently stored, so a save can tell a real deletion
  // from a price list that simply has not finished loading.
  const savedPricingIds = useRef(null);

  // idle (signed out) | loading | ready | error
  const [dataState, setDataState] = useState("idle");
  const [dataError, setDataError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [importOffer, setImportOffer] = useState(false);
  const [importing, setImporting] = useState(false);

  // Every table is readable only by signed-in staff, so loading waits for the
  // session rather than running on mount.
  useEffect(() => {
    // Signed out: nothing to load. State is cleared on logout instead, so
    // this effect never sets state synchronously.
    if (!session) return undefined;

    // Guards against Strict Mode's double invocation seeding twice.
    if (loadedForSession.current === session.user.id) return undefined;
    loadedForSession.current = session.user.id;

    let cancelled = false;

    async function load() {
      setDataState("loading");
      setDataError("");

      try {
        // A brand new project has no price list, so fall back to the bundled
        // one once rather than leaving the till with nothing to sell.
        if (await db.isPricingEmpty()) {
          await db.seedPricing(buildDefaultPricing());
        }

        const [nextOrders, nextWorkers, nextCommission, nextPricing] =
          await Promise.all([
            db.fetchOrders(),
            db.fetchWorkers(),
            db.fetchCommissionSettings(),
            db.fetchPricing(),
          ]);

        if (cancelled) return;

        setOrders(nextOrders);
        setWorkers(nextWorkers);
        setCommissionSettings(nextCommission);
        setPricing(nextPricing);
        savedPricingIds.current = db.collectPricingIds(nextPricing);
        setDataState("ready");
        setImportOffer(!nextWorkers.length && db.hasLocalData(LOCAL_KEYS));
      } catch (error) {
        if (cancelled) return;
        console.error("Could not load data", error);
        setDataError(error.message || "Could not load data.");
        setDataState("error");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // The Services page reports every keystroke, so writes are debounced.
  useEffect(() => {
    if (!session || dataState !== "ready") return undefined;

    const timer = setTimeout(() => {
      db
        .savePricing(pricing, savedPricingIds.current)
        .then(() => {
          savedPricingIds.current = db.collectPricingIds(pricing);
          setSaveError("");
        })
        .catch((error) => {
          console.error("Could not save the price list", error);
          setSaveError(`Price list not saved: ${error.message}`);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [pricing, dataState, session]);

  useEffect(() => {
    if (!session || dataState !== "ready") return undefined;

    const timer = setTimeout(() => {
      db
        .saveCommissionSettings(commissionSettings)
        .then(() => setSaveError(""))
        .catch((error) => {
          console.error("Could not save commission settings", error);
          setSaveError(`Commission settings not saved: ${error.message}`);
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [commissionSettings, dataState, session]);

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

        // If a session is restored while sitting on the Login page, move on
        if (data.session) {
          setActivePage((prev) => (prev === "login" ? "dashboard" : prev));
        }
      }
    }

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setAuthChecked(true);

      if (currentSession) {
        setActivePage((prev) => (prev === "login" ? "dashboard" : prev));
      }
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
    setActivePage("dashboard");
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
      console.error("Could not add the worker", error);
      alert(`Could not add the worker: ${error.message}`);
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
      console.error("Could not update the worker", error);
      alert(`Could not update the worker: ${error.message}`);
    }
  }

  async function deleteWorker(workerId) {
    const hasOrders = orders.some((order) => order.workerId === workerId);

    if (hasOrders) {
      alert(
        "This worker already has sales records. Set their status to Inactive instead of deleting them."
      );
      return;
    }

    const confirmDelete = confirm("Delete this worker profile?");
    if (!confirmDelete) return;

    try {
      await db.deleteWorker(workerId);
      setWorkers((prev) => prev.filter((worker) => worker.id !== workerId));
    } catch (error) {
      console.error("Could not delete the worker", error);
      alert(`Could not delete the worker: ${error.message}`);
    }
  }

  const protectedPages = [
    "form",
    "dashboard",
    "records",
    "workers",
    "services",
  ];
  const needsAuth = protectedPages.includes(activePage);
  const isLoggedIn = Boolean(session);

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setActivePage("form");

    // Do not leave another user's records on screen behind the login wall.
    setOrders([]);
    setWorkers([]);
    setDataState("idle");
    setImportOffer(false);
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
          <button
            className={activePage === "form" ? "active" : ""}
            onClick={() => goToPage("form")}
            title="Worker Form"
          >
            <ClipboardList size={18} />
            <span className="nav-label">Worker Form</span>
          </button>

          {isLoggedIn ? (
            <>
              <button
                className={activePage === "dashboard" ? "active" : ""}
                onClick={() => goToPage("dashboard")}
                title="Admin Dashboard"
              >
                <LayoutDashboard size={18} />
                <span className="nav-label">Admin Dashboard</span>
              </button>

              <button
                className={activePage === "records" ? "active" : ""}
                onClick={() => goToPage("records")}
                title="Sales Records"
              >
                <BarChart3 size={18} />
                <span className="nav-label">Sales Records</span>
              </button>

              <button
                className={activePage === "workers" ? "active" : ""}
                onClick={() => goToPage("workers")}
                title="Workers"
              >
                <UsersRound size={18} />
                <span className="nav-label">Workers</span>
              </button>

              <button
                className={activePage === "services" ? "active" : ""}
                onClick={() => goToPage("services")}
                title="Services"
              >
                <Droplets size={18} />
                <span className="nav-label">Services</span>
              </button>
            </>
          ) : (
            <button
              className={activePage === "login" ? "active" : ""}
              onClick={() => goToPage("login")}
              title="Login"
            >
              <LogIn size={18} />
              <span className="nav-label">Login</span>
            </button>
          )}
        </nav>

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
            <h2>
              {activePage === "form" && "Worker Carwash Entry"}
              {activePage === "dashboard" && "Admin Analytics Dashboard"}
              {activePage === "records" && "Sales Order Records"}
              {activePage === "workers" && "Workers and Commission"}
              {activePage === "services" && "Services and Pricing"}
              {activePage === "login" && "Admin Login"}
            </h2>
          </div>
        </header>

        {!authChecked && needsAuth && (
          <div className="form-card">
            <h2>Checking admin access...</h2>
          </div>
        )}

        {authChecked && needsAuth && !isLoggedIn && (
          <AuthPage onLoginSuccess={(newSession) => setSession(newSession)} />
        )}

        {activePage === "login" && !isLoggedIn && authChecked && (
          <AuthPage
            onLoginSuccess={(newSession) => {
              setSession(newSession);
              setActivePage("dashboard");
            }}
          />
        )}

        {activePage === "login" && !authChecked && (
          <div className="form-card">
            <h2>Checking admin access...</h2>
          </div>
        )}

        {activePage === "form" && (
          <WorkerForm
            onAddOrder={addOrder}
            orders={orders}
            workers={workers}
            commissionSettings={commissionSettings}
            pricingData={pricing.categories}
            addOns={pricing.addOns}
          />
        )}

        {authChecked && isLoggedIn && activePage === "dashboard" && (
          <AdminDashboard orders={orders} workers={workers} />
        )}

        {authChecked && isLoggedIn && activePage === "records" && (
          <SalesRecords
            orders={orders}
            workers={workers}
            onUpdateOrderPayment={updateOrderPayment}
          />
        )}

        {authChecked && isLoggedIn && activePage === "services" && (
          <ServicesManagement pricing={pricing} onUpdatePricing={setPricing} />
        )}

        {authChecked && isLoggedIn && activePage === "workers" && (
          <WorkerManagement
            workers={workers}
            orders={orders}
            onAddWorker={addWorker}
            onUpdateWorker={updateWorker}
            onDeleteWorker={deleteWorker}
            commissionSettings={commissionSettings}
            onUpdateCommissionSettings={setCommissionSettings}
          />
        )}
      </main>
    </div>
  );
}