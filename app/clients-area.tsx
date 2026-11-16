"use client";

import { useState } from "react";
import Building2 from "lucide-react/icons/building-2";
import Siren from "lucide-react/icons/siren";
import ClientsView from "./clients-view";
import IncidentsView from "./incidents-view";

export type ClientsTab = "clients" | "incidents";

/** Clientes e sistemas, com os incidentes (quedas e problemas graves) numa aba ao lado. */
export default function ClientsArea({ initialTab = "clients", onOpenTask, onOpenTicket }: { initialTab?: ClientsTab; onOpenTask: (taskId: number) => void; onOpenTicket: (ticketId: number) => void }) {
  const [tab, setTab] = useState<ClientsTab>(initialTab);
  return <div className="sprints-page">
    <div className="tasks-scope" role="tablist" aria-label="Seções">
      <button role="tab" aria-selected={tab === "clients"} className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}><Building2 size={14} /> Clientes</button>
      <button role="tab" aria-selected={tab === "incidents"} className={tab === "incidents" ? "active" : ""} onClick={() => setTab("incidents")}><Siren size={14} /> Incidentes</button>
    </div>
    {tab === "clients" ? <ClientsView onOpenTask={onOpenTask} onOpenTicket={onOpenTicket} /> : <IncidentsView />}
  </div>;
}
