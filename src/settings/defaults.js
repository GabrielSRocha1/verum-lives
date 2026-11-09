// Valores padrão das configurações editáveis no painel.
// Variáveis disponíveis nos textos: {{primeiro_nome}}, {{nome}}, {{data_live}}, {{dia_semana}}, {{hora_live}},
// {{fuso}}, {{link_live}}, {{link_canal}}, {{link_grupo}}, {{link_descadastro}}

export const CONSENT_VERSION = '2026-11-v1';

export const CONSENT_TEXTS = {
  email: 'Autorizo receber e-mails da Verum relacionados às transmissões ao vivo (confirmações, lembretes e links).',
  whatsapp: 'Autorizo receber mensagens e lembretes das transmissões pelo WhatsApp.'
};

export const STEP_KEYS = ['confirmation', 'd3', 'd1', 'h3', 'm30', 'start'];

export const DEFAULT_SETTINGS = {
  schedule: {
    days: [2, 4],
    time: '19:00',
    timezone: 'America/Sao_Paulo',
    timezoneLabel: 'horário de Brasília',
    durationMinutes: 90
  },
  links: {
    youtubeChannel: '',
    liveUrl: '',
    whatsappGroup: ''
  },
  tracking: {
    metaPixelId: '1475798377861041',
    ga4Id: '',
    gtmId: '',
    requireConsent: true
  },
  presenter: {
    photo: ''
  },
  reminders: {
    steps: [
      {
        key: 'confirmation',
        label: 'Confirmação da inscrição',
        offsetMinutes: null,
        enabled: true,
        channels: { email: true, whatsapp: true },
        email: {
          subject: '{{primeiro_nome}}, sua inscrição está confirmada ✔',
          body:
            'Olá, {{primeiro_nome}}!\n\n' +
            'Sua inscrição nas transmissões ao vivo BITCOIN: OURO DIGITAL! está confirmada.\n\n' +
            'Próxima live: {{dia_semana}}, {{data_live}}, às {{hora_live}} ({{fuso}}).\n' +
            'Onde assistir: {{link_canal}}\n\n' +
            'Quer receber os avisos em primeira mão? Entre no grupo exclusivo do WhatsApp:\n{{link_grupo}}\n\n' +
            'Até lá!\nAdilson Rocha — Canal Verum Cripto'
        },
        whatsapp: { template: '', language: 'pt_BR', params: ['primeiro_nome', 'data_live', 'hora_live'] }
      },
      {
        key: 'd3',
        label: 'Três dias antes',
        offsetMinutes: -4320,
        enabled: true,
        channels: { email: true, whatsapp: false },
        email: {
          subject: 'Em 3 dias: live BITCOIN: OURO DIGITAL!',
          body:
            'Olá, {{primeiro_nome}}!\n\n' +
            'Faltam 3 dias para a nossa próxima transmissão ao vivo: {{dia_semana}}, {{data_live}}, às {{hora_live}} ({{fuso}}).\n\n' +
            'Anote na agenda e ative o lembrete no canal: {{link_canal}}'
        },
        whatsapp: { template: '', language: 'pt_BR', params: ['primeiro_nome', 'data_live', 'hora_live'] }
      },
      {
        key: 'd1',
        label: 'Um dia antes',
        offsetMinutes: -1440,
        enabled: true,
        channels: { email: true, whatsapp: true },
        email: {
          subject: 'É amanhã: live às {{hora_live}}',
          body:
            'Olá, {{primeiro_nome}}!\n\n' +
            'Amanhã, {{data_live}}, às {{hora_live}} ({{fuso}}), estaremos ao vivo falando sobre Bitcoin, autocustódia e dolarização patrimonial.\n\n' +
            'Canal: {{link_canal}}'
        },
        whatsapp: { template: '', language: 'pt_BR', params: ['primeiro_nome', 'data_live', 'hora_live'] }
      },
      {
        key: 'h3',
        label: 'Três horas antes',
        offsetMinutes: -180,
        enabled: true,
        channels: { email: true, whatsapp: false },
        email: {
          subject: 'Hoje às {{hora_live}}: estamos ao vivo',
          body:
            'Olá, {{primeiro_nome}}!\n\n' +
            'Hoje às {{hora_live}} ({{fuso}}) começa a nossa transmissão ao vivo.\n\n' +
            'Link: {{link_live}}'
        },
        whatsapp: { template: '', language: 'pt_BR', params: ['primeiro_nome', 'hora_live'] }
      },
      {
        key: 'm30',
        label: 'Trinta minutos antes',
        offsetMinutes: -30,
        enabled: true,
        channels: { email: true, whatsapp: true },
        email: {
          subject: 'Faltam 30 minutos — link para assistir',
          body:
            '{{primeiro_nome}}, faltam 30 minutos!\n\n' +
            'Assista ao vivo por aqui: {{link_live}}'
        },
        whatsapp: { template: '', language: 'pt_BR', params: ['primeiro_nome', 'link_live'] }
      },
      {
        key: 'start',
        label: 'Horário da transmissão',
        offsetMinutes: 0,
        enabled: true,
        channels: { email: false, whatsapp: true },
        email: {
          subject: 'Estamos AO VIVO agora',
          body: '{{primeiro_nome}}, começamos! Entre agora: {{link_live}}'
        },
        whatsapp: { template: '', language: 'pt_BR', params: ['primeiro_nome', 'link_live'] }
      }
    ]
  }
};

export const TEMPLATE_VARS = [
  'primeiro_nome', 'nome', 'data_live', 'dia_semana', 'hora_live', 'fuso',
  'link_live', 'link_canal', 'link_grupo', 'link_descadastro'
];
