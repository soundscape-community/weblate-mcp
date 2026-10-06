import { Logger } from '@nestjs/common';
import { unitsList, unitsPartialUpdate, type Unit } from '../../client';
import { WeblateClientService } from '../weblate-client.service';
import { WeblateTranslationsService } from './translations.service';

jest.mock('../../client', () => ({
  unitsList: jest.fn(),
  unitsPartialUpdate: jest.fn(),
}));

describe('exact translation keys', () => {
  const key = 'voice.settings.enhanced_available';
  const body = { id: 42, context: key, source: ['Body'] } as Unit;
  const title = {
    id: 43,
    context: `${key}.title`,
    source: ['Title'],
  } as Unit;
  const list = jest.mocked(unitsList);
  const update = jest.mocked(unitsPartialUpdate);
  let service: WeblateTranslationsService;

  function results(units: Unit[], next: string | null = null) {
    list.mockResolvedValue({
      data: { results: units, count: units.length, next },
    } as any);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WeblateTranslationsService({
      getClient: () => ({}),
    } as WeblateClientService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    update.mockResolvedValue({ data: body } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('requests an exact context and ignores a longer key returned first', async () => {
    results([title, body]);
    await expect(
      service.getTranslationByKey('soundscape', 'app', 'fr', key),
    ).resolves.toBe(body);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          page_size: 1000,
          q: `context:="${key}" project:soundscape component:app language:fr`,
        },
      }),
    );
  });

  it.each([[title], [{ ...body, context: key.toUpperCase() }], [undefined]])(
    'does not substitute a nonmatching unit (%j)',
    async (unit) => {
      results(unit ? [unit] : []);
      await expect(
        service.getTranslationByKey('soundscape', 'app', 'fr', key),
      ).resolves.toBeNull();
      await expect(
        service.writeTranslation('soundscape', 'app', 'fr', key, 'New body'),
      ).rejects.toThrow('Translation unit not found');
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('writes the body unit without updating its title', async () => {
    results([title, body]);
    await service.writeTranslation('soundscape', 'app', 'fr', key, 'New body');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: '42' },
        body: { target: ['New body'], state: 20 },
      }),
    );
  });

  it.each([
    [[body, { ...body, id: 44 }], null],
    [[body], 'https://example.com/api/units/?page=2'],
  ])('refuses an ambiguous or incomplete lookup', async (units, next) => {
    results(units as Unit[], next as string | null);
    await expect(
      service.writeTranslation('soundscape', 'app', 'fr', key, 'New body'),
    ).rejects.toThrow('Ambiguous translation key');
    expect(update).not.toHaveBeenCalled();
  });

  it('escapes quotes and backslashes in the exact search expression', async () => {
    const specialKey = 'voice."quoted"\\key';
    results([]);
    await service.getTranslationByKey('soundscape', 'app', 'fr', specialKey);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          q: `context:=${JSON.stringify(specialKey)} project:soundscape component:app language:fr`,
        }),
      }),
    );
  });

  it('finds only the exact key across languages', async () => {
    const otherLanguage = { ...body, id: 45 };
    results([title, body, otherLanguage]);
    await expect(
      service.findTranslationsForKey('soundscape', key, 'app'),
    ).resolves.toEqual([body, otherLanguage]);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          q: `context:="${key}" project:soundscape component:app`,
        }),
      }),
    );
  });
});
