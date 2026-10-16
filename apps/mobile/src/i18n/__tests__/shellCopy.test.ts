import { strings } from '../strings';

test('Q-39 shell copy matches the screen names, sync labels and dismiss label verbatim', () => {
  expect(strings.tabs).toEqual({ index: 'Hoje', pets: 'Pets', walks: 'Passeios', settings: 'Ajustes' });
  expect(strings.sync).toEqual({
    synced: 'sincronizado', syncing: 'sincronizando', offline: 'offline', reserveSuffix: ' · reserva',
  });
  expect(strings.dismiss).toBe('Fechar');
});
