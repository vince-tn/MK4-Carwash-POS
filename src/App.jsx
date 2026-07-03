import { useEffect, useState } from "react";
import {
  BarChart3,
  ClipboardList,
  Droplets,
  LayoutDashboard,
  UsersRound,
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
import { buildDefaultPricing, ensurePricingIds } from "./data/pricing";

const ORDERS_STORAGE_KEY = "mk4-auto-care-orders";
const WORKERS_STORAGE_KEY = "mk4-auto-care-workers";
const COMMISSION_STORAGE_KEY = "mk4-auto-care-commission-settings";
const PRICING_STORAGE_KEY = "mk4-auto-care-pricing";

const defaultWorkers = [
  {
    id: "worker-frank",
    name: "Frank",
    role: "Washer",
    phone: "",
    address: "",
    status: "Active",
    dateJoined: "2026-04-01",
    notes: "Sample worker profile.",
    commissionMode: "inherit",
    commissionValue: "",
  },
  {
    id: "worker-john",
    name: "John",
    role: "Washer",
    phone: "",
    address: "",
    status: "Active",
    dateJoined: "2026-04-01",
    notes: "",
    commissionMode: "inherit",
    commissionValue: "",
  },
];

const defaultCommissionSettings = {
  globalMode: "service_percent",
  globalValue: "100",
};

const sampleOrders = [
  {
    id: "SO-20260413-001",
    date: "2026-04-13",
    plateNumber: "EMERALD WFO 8289",
    customerName: "",
    contactNumber: "",
    carType: "Medium",
    workerId: "worker-frank",
    washerName: "Frank",
    manager: "Manager",
    services: [
      {
        id: "service-1",
        category: "Wash and Wax",
        size: "Medium",
        price: 880,
        commissionType: "Washing",
        commissionRate: 30,
      },
    ],
    selectedAddOns: [],
    paymentEnabled: {
      cash: false,
      gcash: true,
      credit: false,
      discount: false,
    },
    serviceTotal: 880,
    addOnTotal: 0,
    total: 880,
    cash: "",
    gcash: "880",
    credit: "",
    discount: "",
    totalPaid: 880,
    balance: 0,
    commission: 264,
    commissionLabel: "Service percentage",
    referenceNo: "3039731622544",
    photoName: "proof-photo.jpg",
    notes: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "SO-20260413-002",
    date: "2026-04-13",
    plateNumber: "ABC 1234",
    customerName: "",
    contactNumber: "",
    carType: "Large",
    workerId: "worker-john",
    washerName: "John",
    manager: "Manager",
    services: [
      {
        id: "service-2",
        category: "Premium Wash",
        size: "Large",
        price: 280,
        commissionType: "Washing",
        commissionRate: 30,
      },
    ],
    selectedAddOns: ["Mr Pink"],
    paymentEnabled: {
      cash: true,
      gcash: false,
      credit: false,
      discount: false,
    },
    serviceTotal: 280,
    addOnTotal: 100,
    total: 380,
    cash: "380",
    gcash: "",
    credit: "",
    discount: "",
    totalPaid: 380,
    balance: 0,
    commission: 84,
    commissionLabel: "Service percentage",
    referenceNo: "",
    photoName: "",
    notes: "",
    createdAt: new Date().toISOString(),
  },
];

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [activePage, setActivePage] = useState("form");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [orders, setOrders] = useState(() => {
    return safeJsonParse(localStorage.getItem(ORDERS_STORAGE_KEY), sampleOrders);
  });

  const [workers, setWorkers] = useState(() => {
    return safeJsonParse(localStorage.getItem(WORKERS_STORAGE_KEY), defaultWorkers);
  });

  const [commissionSettings, setCommissionSettings] = useState(() => {
    return safeJsonParse(
      localStorage.getItem(COMMISSION_STORAGE_KEY),
      defaultCommissionSettings
    );
  });

  const [pricing, setPricing] = useState(() => {
    const stored = safeJsonParse(localStorage.getItem(PRICING_STORAGE_KEY), null);
    return stored ? ensurePricingIds(stored) : buildDefaultPricing();
  });

  useEffect(() => {
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem(WORKERS_STORAGE_KEY, JSON.stringify(workers));
  }, [workers]);

  useEffect(() => {
    localStorage.setItem(
      COMMISSION_STORAGE_KEY,
      JSON.stringify(commissionSettings)
    );
  }, [commissionSettings]);

  useEffect(() => {
    localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(pricing));
  }, [pricing]);

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

  function addOrder(order) {
    setOrders((prev) => [order, ...prev]);
    setActivePage("dashboard");
  }

  function clearOrders() {
    const confirmClear = confirm(
      "This will clear all demo orders from this browser. Continue?"
    );

    if (!confirmClear) return;

    setOrders([]);
  }
  
  function updateOrderPayment(orderId, paymentUpdate) {
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;

        const updatedOrder = {
          ...order,
          paymentEnabled: paymentUpdate.paymentEnabled,
          cash: paymentUpdate.cash,
          gcash: paymentUpdate.gcash,
          credit: paymentUpdate.credit,
          discount: paymentUpdate.discount,
          referenceNo: paymentUpdate.referenceNo,
          paymentNotes: paymentUpdate.paymentNotes,
          paymentUpdatedAt: new Date().toISOString(),
        };

        const discount = updatedOrder.paymentEnabled?.discount
          ? Number(updatedOrder.discount) || 0
          : 0;

        const total = Math.max(
          Number(updatedOrder.serviceTotal || 0) +
            Number(updatedOrder.addOnTotal || 0) -
            discount,
          0
        );

        const totalPaid =
          (updatedOrder.paymentEnabled?.cash ? Number(updatedOrder.cash) || 0 : 0) +
          (updatedOrder.paymentEnabled?.gcash ? Number(updatedOrder.gcash) || 0 : 0) +
          (updatedOrder.paymentEnabled?.credit ? Number(updatedOrder.credit) || 0 : 0);

        return {
          ...updatedOrder,
          total,
          totalPaid,
          balance: total - totalPaid,
        };
      })
    );
  }

  function addWorker(worker) {
    setWorkers((prev) => [worker, ...prev]);
  }

  function updateWorker(workerId, updatedWorker) {
    setWorkers((prev) =>
      prev.map((worker) =>
        worker.id === workerId ? { ...worker, ...updatedWorker } : worker
      )
    );
  }

  function deleteWorker(workerId) {
    const hasOrders = orders.some((order) => order.workerId === workerId);

    if (hasOrders) {
      alert(
        "This worker already has sales records. Set their status to Inactive instead of deleting them."
      );
      return;
    }

    const confirmDelete = confirm("Delete this worker profile?");
    if (!confirmDelete) return;

    setWorkers((prev) => prev.filter((worker) => worker.id !== workerId));
  }

  const protectedPages = ["dashboard", "records", "workers", "services"];
  const needsAuth = protectedPages.includes(activePage);
  const isLoggedIn = Boolean(session);

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setActivePage("form");
  }

  function goToPage(page) {
    setActivePage(page);
  }
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-logo-wrap">
              <img src={logo} alt="MK4 Auto Care" />
            </div>
            <div className="brand-text">
              <h1>MK4 Auto Care</h1>
              <p>Carwash POS Prototype</p>
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
        </nav>

        {isLoggedIn && (
          <button className="logout-btn" onClick={handleLogout} title="Logout">
            <LogOut size={18} />
            <span className="nav-label">Logout</span>
          </button>
        )}
        {/* <div className="sidebar-note">
          <strong>Prototype only</strong>
          <p>
            Data is saved in browser localStorage. CSV export is available in
            Sales Records. Later, this can be connected to Google Sheets,
            Supabase, Firebase, or Airtable.
          </p>
        </div> */}
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
            onClearOrders={clearOrders}
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