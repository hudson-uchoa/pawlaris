import { strings } from '../strings';

test('P7-3 06 section 4.10 and 09 pin the empty-state copy verbatim', () => {
  expect(strings.dashboard.emptyTitle).toBe('Céu limpo por hoje.');
  expect(strings.dashboard.createTask).toBe('Criar tarefa');
  expect(strings.pets.emptyTitle).toBe('Nenhuma estrela por aqui ainda.');
  expect(strings.pets.addPet).toBe('Adicionar pet');
  expect(strings.walks.emptyTitle).toBe('Nenhum passeio registrado.');
  expect(strings.health.emptyTitle).toBe('Nada registrado ainda.');
  expect(strings.health.add).toBe('Adicionar');
  expect(strings.weights.empty).toBe('Registre pelo menos dois pesos para ver a evolução.');
});
