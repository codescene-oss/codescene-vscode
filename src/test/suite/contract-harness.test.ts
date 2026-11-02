import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertCasing,
  assertDeclaredFieldsMatch,
  assertRequiredFieldsDeclared,
  contractRoot,
  fixture,
  fixtureVariants,
  loadManifest,
  manifestEntry,
  schemaDefinition,
  toKebabKeys,
  useContractDir,
  validate,
} from '../contract/contract';

suite('Contract harness Test Suite', () => {
  suite('bundle', () => {
    test('loads the wire manifest of the pinned bundle', () => {
      const entry = manifestEntry('cs-ide/review');
      assert.strictEqual(entry.status, 'schematized');
      assert.deepStrictEqual(entry.result, {
        schema: 'review.json',
        definition: 'Review',
        casing: 'camel',
        nullable: false,
      });
      assert.ok(loadManifest().length > 0);
    });

    test('rejects a method the manifest does not list', () => {
      assert.throws(() => manifestEntry('cs-ide/no-such-method'), /no entry for cs-ide\/no-such-method/);
    });

    test('loads fixtures in entity and wire form', () => {
      assert.ok('raw-score' in fixture('review', 'minimal', 'entity'));
      assert.ok('rawScore' in fixture('review', 'minimal', 'wire'));
    });

    test('lists the variants of a fixture root and reads a definition of a schema', () => {
      assert.deepStrictEqual(fixtureVariants('delta-review-notification'), ['full', 'minimal', 'null-result']);
      assert.throws(() => fixtureVariants('no-such-root'), /Unknown fixture root "no-such-root"/);
      assert.ok(schemaDefinition('wire.json', 'AuthErrorCode').enum.includes('auth/cancelled'));
      assert.throws(() => schemaDefinition('wire.json', 'NoSuchDefinition'), /no definition "NoSuchDefinition"/);
    });

    test('rejects an unknown fixture root and an unknown variant', () => {
      assert.throws(() => fixture('no-such-root', 'minimal', 'entity'), /Unknown fixture root "no-such-root"/);
      assert.throws(() => fixture('review', 'no-such-variant', 'entity'), /no variant "no-such-variant"/);
    });
  });

  suite('missing bundle', () => {
    let restore: () => void;
    let emptyDir: string;

    setup(() => {
      emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-contract-harness-'));
      restore = useContractDir(path.join(emptyDir, 'cs-ide-contract'));
    });

    teardown(() => {
      restore();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    test('every entry point throws when cs-ide-contract/ is missing', () => {
      assert.throws(() => contractRoot(), /contract bundle is missing/);
      assert.throws(() => loadManifest(), /contract bundle is missing/);
      assert.throws(() => fixture('review', 'minimal', 'entity'), /contract bundle is missing/);
      assert.throws(() => validate('review.json', 'Review', {}), /contract bundle is missing/);
    });

    test('a bundle without the requested schema file throws instead of passing', () => {
      fs.mkdirSync(path.join(emptyDir, 'cs-ide-contract', 'schemas'), { recursive: true });
      assert.throws(() => validate('review.json', 'Review', {}), /no schemas[\\/]review\.json/);
    });
  });

  suite('validate', () => {
    for (const variant of ['minimal', 'full']) {
      test(`accepts the ${variant} review entity fixture`, () => {
        validate('review.json', 'Review', fixture('review', variant, 'entity'));
      });

      test(`accepts the ${variant} review wire fixture once its keys are kebab-case`, () => {
        validate('review.json', 'Review', toKebabKeys(fixture('review', variant, 'wire')));
      });
    }

    test('rejects the camelCase wire form, which the schemas do not describe', () => {
      assert.throws(() => validate('review.json', 'Review', fixture('review', 'minimal', 'wire')), /does not validate/);
    });

    test('rejects a missing required field and a wrong type', () => {
      const { 'raw-score': _rawScore, ...withoutRawScore } = fixture('review', 'minimal', 'entity');
      assert.throws(() => validate('review.json', 'Review', withoutRawScore), /raw-score/);
      assert.throws(() => validate('review.json', 'Review', { ...fixture('review', 'minimal', 'entity'), score: 'high' }), /number/);
    });

    test('rejects an unknown definition', () => {
      assert.throws(() => validate('review.json', 'NoSuchDefinition', {}), /no definition "NoSuchDefinition"/);
    });

    test('validates a definition that is not the file root', () => {
      validate('wire.json', 'ReviewParams', fixture('review-params', 'minimal', 'wire'));
    });

    test('the negative test: a review wire fixture with an injected unknown field fails validation', () => {
      const wire = fixture('review', 'minimal', 'wire');
      validate('review.json', 'Review', toKebabKeys(wire));

      const topLevel = toKebabKeys({ ...wire, unexpectedField: true });
      assert.throws(() => validate('review.json', 'Review', topLevel), /additional properties/);

      const nested = toKebabKeys(wire) as any;
      nested['function-level-code-smells'][0].range['unexpected-field'] = 1;
      assert.throws(() => validate('review.json', 'Review', nested), /additional properties/);
    });
  });

  suite('assertCasing', () => {
    test('accepts the wire fixture as camel and the entity fixture as kebab', () => {
      assertCasing(fixture('review', 'full', 'wire'), 'camel');
      assertCasing(fixture('review', 'full', 'entity'), 'kebab');
    });

    test('the negative test: the review wire fixture with one key re-cased fails assertCasing', () => {
      const wire = fixture('review', 'minimal', 'wire');
      assertCasing(wire, 'camel');

      const topLevel = { ...wire, 'raw-score': wire.rawScore };
      delete topLevel.rawScore;
      assert.throws(() => assertCasing(topLevel, 'camel'), /\$\.raw-score/);

      const nested = JSON.parse(JSON.stringify(wire));
      nested.functionLevelCodeSmells[0].codeSmells[0]['highlight-range'] = nested.functionLevelCodeSmells[0].codeSmells[0].highlightRange;
      delete nested.functionLevelCodeSmells[0].codeSmells[0].highlightRange;
      assert.throws(() => assertCasing(nested, 'camel'), /functionLevelCodeSmells\[0\]\.codeSmells\[0\]\.highlight-range/);
    });

    test('rejects an uppercase letter where kebab-case is required', () => {
      assert.throws(() => assertCasing({ 'repo-path': 'x', repoRoot: 'y' }, 'kebab'), /\$\.repoRoot/);
    });

    test('checks keys inside arrays but not string values', () => {
      assertCasing({ items: [{ 'some-key': 'SomeValue' }] }, 'kebab');
      assert.throws(() => assertCasing({ items: [{ someKey: 1 }] }, 'kebab'), /items\[0\]\.someKey/);
    });
  });

  suite('assertDeclaredFieldsMatch', () => {
    const declared = ['score', 'file-level-code-smells', 'function-level-code-smells.range.start-line', 'raw-score'];

    test('accepts an entity that carries exactly the fixture values', () => {
      for (const variant of ['minimal', 'full']) {
        const entity = fixture('review', variant, 'entity');
        assertDeclaredFieldsMatch(entity, entity, declared);
      }
    });

    test('the negative test: a defaulted optional (score: 0 where the fixture has none) fails', () => {
      const minimal = fixture('review', 'minimal', 'entity');
      assert.strictEqual('score' in minimal, false);
      assert.throws(() => assertDeclaredFieldsMatch(minimal, { ...minimal, score: 0 }, declared), /\$\.score: fixture has \(absent\), entity has 0/);
    });

    test('an optional the entity drops fails', () => {
      const full = fixture('review', 'full', 'entity');
      const { score: _score, ...withoutScore } = full;
      assert.throws(() => assertDeclaredFieldsMatch(full, withoutScore, declared), /\$\.score: fixture has 8\.5, entity has \(absent\)/);
    });

    test('a changed value fails, also under an array', () => {
      const full = fixture('review', 'full', 'entity');
      assert.throws(() => assertDeclaredFieldsMatch(full, { ...full, score: 9 }, declared), /\$\.score/);

      const changed = JSON.parse(JSON.stringify(full));
      changed['function-level-code-smells'][0].range['start-line'] = 99;
      assert.throws(
        () => assertDeclaredFieldsMatch(full, changed, declared),
        /\$\.function-level-code-smells\[0\]\.range\.start-line: fixture has 3, entity has 99/
      );
    });

    test('an array with another length fails', () => {
      const full = fixture('review', 'full', 'entity');
      const shorter = { ...full, 'function-level-code-smells': [] };
      assert.throws(() => assertDeclaredFieldsMatch(full, shorter, declared), /fixture has 1 items, entity has 0/);
    });

    test('a field the model does not declare is not compared', () => {
      const minimal = fixture('review', 'minimal', 'entity');
      assertDeclaredFieldsMatch(minimal, { ...minimal, score: 0 }, ['raw-score']);
    });

    test('a property left undefined is absent, as it is after JSON serialization', () => {
      const minimal = fixture('review', 'minimal', 'entity');
      assertDeclaredFieldsMatch(minimal, { ...minimal, score: undefined }, declared);
    });

    test('null differs from absent', () => {
      const withNull = { ...fixture('review', 'minimal', 'entity'), score: null };
      const minimal = fixture('review', 'minimal', 'entity');
      assert.throws(() => assertDeclaredFieldsMatch(minimal, withNull, ['score']), /fixture has \(absent\), entity has null/);
      assertDeclaredFieldsMatch(withNull, withNull, ['score']);
    });

    test('reports every differing field at once', () => {
      const minimal = fixture('review', 'minimal', 'entity');
      const entity = { ...minimal, score: 0, 'raw-score': 'other' };
      assert.throws(() => assertDeclaredFieldsMatch(minimal, entity, declared), /score[\s\S]*raw-score/);
    });
  });

  suite('assertRequiredFieldsDeclared', () => {
    const range = ['start-line', 'start-column', 'end-line', 'end-column'];
    const codeSmell = ['category', 'details', ...range.map((field) => `highlight-range.${field}`)];
    const fileReview = [
      ...codeSmell.map((field) => `file-level-code-smells.${field}`),
      'function-level-code-smells.function',
      ...range.map((field) => `function-level-code-smells.range.${field}`),
      ...codeSmell.map((field) => `function-level-code-smells.code-smells.${field}`),
      'raw-score',
      'git-blob-sha',
    ];

    test('accepts a model that declares every required field and none of the optional ones', () => {
      assertRequiredFieldsDeclared('wire.json', 'FileReviewResult', fileReview);
    });

    test('a required field the model leaves out fails, also below a declared field', () => {
      assert.throws(
        () => assertRequiredFieldsDeclared('wire.json', 'FileReviewResult', fileReview.filter((field) => field !== 'raw-score')),
        /requires: raw-score/
      );
      assert.throws(
        () =>
          assertRequiredFieldsDeclared(
            'wire.json',
            'FileReviewResult',
            fileReview.filter((field) => field !== 'file-level-code-smells.highlight-range.end-column')
          ),
        /requires: file-level-code-smells.highlight-range.end-column/
      );
    });

    test('an optional field is checked below only once the model declares it', () => {
      const withRulesError = [...fileReview, 'code-health-rules-error.description'];
      assert.throws(
        () => assertRequiredFieldsDeclared('wire.json', 'FileReviewResult', withRulesError),
        /requires: code-health-rules-error.remedy/
      );
    });

    test('looks into a nullable property, so a nullable required field must be declared', () => {
      const declared = ['path', 'repo-root', 'result.score-change', 'result.file-level-findings.change-type'];
      assert.throws(
        () => assertRequiredFieldsDeclared('wire.json', 'DeltaReviewNotification', declared),
        /result.old-git-blob-sha, result.new-git-blob-sha/
      );
    });

    test('rejects an unknown definition', () => {
      assert.throws(() => assertRequiredFieldsDeclared('wire.json', 'NoSuchDefinition', []), /no definition "NoSuchDefinition"/);
    });
  });
});
