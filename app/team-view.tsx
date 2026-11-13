"use client";

import { endMemberSessions } from "./sessions-panel";
import LogOut from "lucide-react/icons/log-out";
import Pencil from "lucide-react/icons/pencil";
import Trash2 from "lucide-react/icons/trash-2";
import UserPlus from "lucide-react/icons/user-plus";
import Users from "lucide-react/icons/users";
import { type MemberRole, type Member, type CurrentUser, MemberVisual } from "./dashboard-shared";

export function TeamView({ members, currentUser, saving, onAddMember, onEditMember, onDeleteMember, onUpdateRole, onUpdateActive }: { members: Member[]; currentUser: CurrentUser | null; saving: boolean; onAddMember: () => void; onEditMember: (member: Member) => void; onDeleteMember: (member: Member) => void; onUpdateRole: (userId: string, role: MemberRole) => void; onUpdateActive: (userId: string, active: boolean) => void }) {
  return (
    <>
      <div className="team-intro">
        <span className="team-intro-icon"><Users /></span>
        <div><h2>Usuários e permissões</h2><p>Cada pessoa entra com sua própria conta, e tudo o que ela faz fica registrado no nome dela. Cargo, telefone e times ficam na área Pessoas.</p></div>
      </div>
      <div className="permission-cards">
        <article><strong>Administrador</strong><p>Acesso total: cria usuários, monta os times, edita a escala, atende qualquer chamado e pode excluir demandas e chamados.</p></article>
        <article><strong>Membro</strong><p>Cria e edita demandas, abre chamados e atende os do seu time. No estoque e na escala, faz o que o administrador liberar.</p></article>
        <article><strong>Somente leitura</strong><p>Consulta demandas, chamados, escala, estoque e pessoas, sem alterar nada.</p></article>
      </div>
      <div className="team-panel">
        <div className="section-heading team-heading"><div><h2>Usuários cadastrados</h2><p>Crie o usuário e a senha inicial e escolha o perfil. As permissões extras do estoque e da escala ficam na aba Permissões de cada pessoa.</p></div><div className="team-heading-actions"><span>{members.length} {members.length === 1 ? "usuário" : "usuários"}</span><button className="secondary-button" onClick={onAddMember}><UserPlus size={16} /> Adicionar membro</button></div></div>
        <div className="team-table">
          <div className="team-table-head"><span>Usuário</span><span>Permissão</span><span>Status</span><span>Entrada</span><span>Ações</span></div>
          {members.map((member) => <div className="team-row" key={member.userId}>
            <div className="member-cell"><MemberVisual member={member} /><div><strong>{member.name}</strong><small>@{member.username || "acesso-pendente"} · {member.email}{member.userId === currentUser?.userId ? " · você" : ""}</small></div></div>
            <select aria-label={`Permissão de ${member.name}`} disabled={saving || member.userId === currentUser?.userId} value={member.role} onChange={(event) => onUpdateRole(member.userId, event.target.value as MemberRole)}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Somente leitura</option></select>
            <button className={`access-toggle ${member.active ? "active" : "inactive"}`} disabled={saving || member.userId === currentUser?.userId} onClick={() => onUpdateActive(member.userId, !member.active)}>{member.active ? "Ativo" : "Desativado"}</button>
            <span className="member-date">{new Intl.DateTimeFormat("pt-BR").format(new Date(member.createdAt))}</span>
            <div className="member-actions"><button className="member-edit" disabled={member.userId === currentUser?.userId} onClick={async () => {
              if (!window.confirm(`Desconectar ${member.name} de todos os aparelhos? A pessoa vai precisar entrar de novo com a senha.`)) return;
              try { const ended = await endMemberSessions(member.id); window.alert(ended ? `${member.name} foi desconectado(a) de ${ended} ${ended === 1 ? "aparelho" : "aparelhos"}.` : `${member.name} não estava conectado(a) em nenhum aparelho.`); } catch (err) { window.alert(err instanceof Error ? err.message : "Não foi possível desconectar."); }
            }} aria-label={`Desconectar ${member.name} de todos os aparelhos`} title="Desconectar de todos os aparelhos"><LogOut size={15} /></button><button className="member-edit" disabled={member.userId === currentUser?.userId} onClick={() => onEditMember(member)} aria-label={`Editar ${member.name}`} title={member.userId === currentUser?.userId ? "Use Meu perfil" : "Editar membro"}><Pencil size={15} /></button><button className="member-delete" disabled={member.userId === currentUser?.userId} onClick={() => onDeleteMember(member)} aria-label={`Excluir ${member.name}`} title="Excluir membro"><Trash2 size={15} /></button></div>
          </div>)}
        </div>
        <p className="team-access-note">O usuário e a senha dão acesso ao sistema. As permissões são verificadas novamente pelo servidor em cada operação.</p>
      </div>
    </>
  );
}
