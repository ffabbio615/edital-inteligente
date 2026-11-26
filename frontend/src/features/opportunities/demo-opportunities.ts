import type { OpportunityPreview } from '../../types/opportunity'

/**
 * DADOS FICTÍCIOS DE DEMONSTRAÇÃO.
 * Servem apenas para compor o layout da página pública. Não representam
 * editais reais e não vêm da API. Serão substituídos quando a integração
 * com o backend for implementada.
 */
export const demoOpportunities: OpportunityPreview[] = [
  {
    id: 'demo-1',
    title: 'Edital de exemplo para projetos de inovação tecnológica',
    institution: 'Instituição Exemplo A',
    category: 'grant',
    summary: 'Texto ilustrativo sobre apoio a projetos de inovação desenvolvidos por pequenas empresas.',
    deadline: '2027-03-15',
  },
  {
    id: 'demo-2',
    title: 'Programa de exemplo de aceleração para startups',
    institution: 'Instituição Exemplo B',
    category: 'acceleration',
    summary: 'Texto ilustrativo sobre mentoria, capacitação e conexão com investidores.',
    deadline: '2027-02-28',
  },
  {
    id: 'demo-3',
    title: 'Chamada de exemplo para bolsas de pesquisa',
    institution: 'Instituição Exemplo C',
    category: 'scholarship',
    summary: 'Texto ilustrativo sobre bolsas para pesquisadores em diferentes áreas do conhecimento.',
    deadline: null,
  },
]
