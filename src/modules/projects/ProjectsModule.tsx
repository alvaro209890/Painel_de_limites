import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { ProjectService } from '../../types/dashboard'
import { formatDate } from '../../utils/format'

type ProjectsModuleProps = {
  projects: ProjectService[]
  loading?: boolean
  error?: string | null
}

export function ProjectsModule({ projects, loading, error }: ProjectsModuleProps) {
  if (loading) return <SectionCard title="Projetos"><p className="text-slate-400">Carregando projetos...</p></SectionCard>
  if (error) return <SectionCard title="Projetos"><p className="text-rose-200">{error}</p></SectionCard>

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {projects.map((project) => (
        <SectionCard key={project.id}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black text-white">{project.name}</h2>
              <p className="mt-1 text-sm text-slate-400">{project.deployTarget || project.kind}</p>
            </div>
            <StatusBadge status={project.status} />
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-black/20 p-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Porta</dt>
              <dd className="mt-1 font-bold text-slate-100">{project.port || '--'}</dd>
            </div>
            <div className="rounded-2xl bg-black/20 p-3">
              <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Tipo</dt>
              <dd className="mt-1 font-bold text-slate-100">{project.kind}</dd>
            </div>
          </dl>

          <div className="mt-4 space-y-2 text-sm">
            {project.publicUrl && (
              <a className="block truncate rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100 hover:bg-cyan-300/15" href={project.publicUrl} target="_blank" rel="noreferrer">
                Público: {project.publicUrl}
              </a>
            )}
            {project.healthUrl && <p className="truncate text-slate-500">Health: {project.healthUrl}</p>}
            <p className="text-xs text-slate-500">Checado: {formatDate(project.lastCheckedAt)}</p>
          </div>
        </SectionCard>
      ))}
      {!projects.length && <SectionCard title="Projetos"><p className="text-slate-400">Nenhum projeto cadastrado em <code>config/projects.json</code>.</p></SectionCard>}
    </div>
  )
}
