import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import StatCard from "./StatCard";
import WorkerReports from "./WorkerReports";
import DashboardReport from "./DashboardReport";
import { localDateString } from "../lib/reportUtils";
import { isSalesWorker } from "../lib/access";
import { amountFor, moneyTaken } from "../lib/totals";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

export default function AdminDashboard({ orders, workers }) {
  const [expandedCard, setExpandedCard] = useState(null);

  // Everything below depends only on the sales, so it is worked out in one
  // pass and kept until they change, not redone each time a card is opened.
  const stats = useMemo(() => {
    const totals = {
      sales: 0,
      cash: 0,
      gcash: 0,
      credit: 0,
      bank: 0,
      discount: 0,
      commission: 0,
    };
    const serviceMap = {};
    const workerMap = {};

    orders.forEach((order) => {
      totals.cash += amountFor(order, "cash");
      totals.gcash += amountFor(order, "gcash");
      totals.credit += amountFor(order, "credit");
      totals.bank += amountFor(order, "bank");
      totals.discount += amountFor(order, "discount");
      totals.commission += Number(order.commission || 0);

      order.services?.forEach((service) => {
        serviceMap[service.category] =
          (serviceMap[service.category] || 0) + Number(service.price || 0);
      });

      if (!workerMap[order.washerName]) {
        workerMap[order.washerName] = {
          worker: order.washerName,
          workerId: order.workerId,
          cars: 0,
          commission: 0,
          sales: 0,
        };
      }

      workerMap[order.washerName].cars += 1;
      workerMap[order.washerName].commission += Number(order.commission || 0);
      workerMap[order.washerName].sales += moneyTaken(order);
    });

    // Total Sales is money actually taken: the Cash, GCash and Credit
    // totals added up, which is what the shop sheet means by the term. It
    // deliberately leaves out any balance still owed. The discount was never
    // part of it either way -- order.total was already net of it.
    totals.sales = totals.cash + totals.gcash + totals.credit + totals.bank;

    return {
      ...totals,
      washerChartData: Object.values(workerMap).sort((a, b) => b.sales - a.sales),
      serviceMixData: Object.entries(serviceMap)
        .map(([name, total]) => ({ name, total }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total),
    };
  }, [orders]);

  const {
    sales: totalSales,
    cash: cashSales,
    gcash: gcashSales,
    credit: creditSales,
    bank: bankSales,
    discount: totalDiscount,
    commission: totalCommission,
    washerChartData,
    serviceMixData,
  } = stats;
  const totalCars = orders.length;

  // The quota is per day. Every other figure on this page is all-time.
  const quotaTarget = 60;
  const today = localDateString();
  const carsToday = orders.filter((order) => order.date === today).length;
  const quotaPercent = Math.min((carsToday / quotaTarget) * 100, 100);

  const topWorker = washerChartData[0];
  const salesWorkers = workers.filter(isSalesWorker);
  const activeWorkers = salesWorkers.filter((worker) => worker.status === "Active");

  function toggleCard(cardKey) {
    setExpandedCard((prev) => (prev === cardKey ? null : cardKey));
  }

  const expandedPanels = {
    sales: {
      title: "Sales Report — Payment Breakdown",
    },
    cars: {
      title: "Cars Washed Report — By Car Type",
    },
    commission: {
      title: "Commission Report — Per Worker",
    },
    topworker: {
      title: `Worker Reports${topWorker ? ` — Top: ${topWorker.worker}` : ""}`,
    },
  };

  const activePanel = expandedCard ? expandedPanels[expandedCard] : null;

  return (
    <section className="dashboard">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Admin Dashboard</span>
          <h2>Sales, Quota and Commission Overview</h2>
        </div>

        <div className="quota-pill">
          <span>Daily Quota</span>
          <strong>
            {carsToday}/{quotaTarget} cars
          </strong>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          title="Total Sales"
          value={peso.format(totalSales)}
          onClick={() => toggleCard("sales")}
          active={expandedCard === "sales"}
        />
        <StatCard
          title="Total Cars"
          value={totalCars}
          subtext="All time"
          onClick={() => toggleCard("cars")}
          active={expandedCard === "cars"}
        />
        <StatCard
          title="Total Commission"
          value={peso.format(totalCommission)}
          onClick={() => toggleCard("commission")}
          active={expandedCard === "commission"}
        />
        <StatCard
          title="Top Worker"
          value={topWorker ? topWorker.worker : "—"}
          subtext={
            topWorker
              ? `${peso.format(topWorker.sales)} • ${activeWorkers.length} active workers`
              : `${activeWorkers.length} active workers`
          }
          onClick={() => toggleCard("topworker")}
          active={expandedCard === "topworker"}
        />
        <StatCard title="GCash Sales" value={peso.format(gcashSales)} />
        <StatCard title="Credit Sales" value={peso.format(creditSales)} />
        <StatCard title="Bank Sales" value={peso.format(bankSales)} />
        <StatCard title="Discounts" value={peso.format(totalDiscount)} />
        <StatCard title="Cash Sales" value={peso.format(cashSales)} />
      </div>

      {activePanel && (
        <div className="chart-card">
          <div className="report-header">
            <h3>{activePanel.title}</h3>
            <button
              className="ghost-btn"
              onClick={() => setExpandedCard(null)}
            >
              Close ▲
            </button>
          </div>

          {expandedCard === "topworker" ? (
            <WorkerReports
              orders={orders}
              workers={salesWorkers}
              initialView="individual"
              initialWorkerId={topWorker?.workerId || ""}
            />
          ) : (
            <DashboardReport
              key={expandedCard}
              orders={orders}
              mode={expandedCard}
            />
          )}
        </div>
      )}

      <div className="quota-card">
        <div>
          <h3>Daily Quota Progress</h3>
          <p>Target: 60 cars daily</p>
        </div>

        <div className="quota-bar">
          <div style={{ width: `${quotaPercent}%` }} />
        </div>

        <strong>
          {quotaPercent >= 100
            ? "Quota reached. Incentive unlocked."
            : `${quotaTarget - carsToday} cars remaining today`}
        </strong>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Worker Sales Performance</h3>

          {washerChartData.length === 0 ? (
            <p className="empty">No sales data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={washerChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="worker" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip formatter={(value) => peso.format(value)} />
                <Bar dataKey="sales" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <h3>Service Mix by Revenue</h3>

          {serviceMixData.length === 0 ? (
            <p className="empty">No service data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={serviceMixData}
                  dataKey="total"
                  nameKey="name"
                  outerRadius={105}
                  label
                >
                  {serviceMixData.map((entry) => (
                    <Cell key={entry.name} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => peso.format(value)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="chart-card">
        <h3>Worker Commission Summary</h3>

        {washerChartData.length === 0 ? (
          <p className="empty">No worker data yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Cars</th>
                  <th>Sales Handled</th>
                  <th>Commission</th>
                </tr>
              </thead>
              <tbody>
                {washerChartData.map((worker) => (
                  <tr key={worker.worker}>
                    <td>{worker.worker}</td>
                    <td>{worker.cars}</td>
                    <td>{peso.format(worker.sales)}</td>
                    <td>{peso.format(worker.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}