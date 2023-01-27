import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import { isArray } from '@ember/array';
import { run } from '@ember/runloop';
import EmberObject, { get, set } from '@ember/object';
import { resolve } from 'rsvp';
import DefaultSchema from 'ember-m3/services/m3-schema';
import { settled } from '@ember/test-helpers';

function _resolve(urn) {
  let id = urn;
  let type = null;

  if (/^isbn/i.test(urn)) {
    type = 'com.example.bookstore.Book';
  }

  return {
    id,
    type,
  };
}

let computeAttributeReference = function computeAttributeReference(
  key,
  _value,
  _modelName,
  schemaInterface
) {
  let refValue = schemaInterface.getAttr(`*${key}`);
  if (isArray(refValue)) {
    return refValue.map(_resolve);
  }

  if (refValue !== undefined) {
    return _resolve(refValue);
  }
};
class TestSchema extends DefaultSchema {
  includesModel(modelName) {
    return /^com.example.bookstore\./i.test(modelName);
  }

  computeAttribute(key, value, modelName, schemaInterface) {
    let reference = computeAttributeReference(key, value, modelName, schemaInterface);
    if (Array.isArray(reference)) {
      return schemaInterface.managedArray(reference.map((r) => schemaInterface.reference(r)));
    } else if (reference) {
      return schemaInterface.reference(reference);
    }
  }
}

class TestSchemaOldHooks extends DefaultSchema {
  includesModel(modelName) {
    return /^com.example.bookstore\./i.test(modelName);
  }

  computeAttributeReference(key, value, modelName, schemaInterface) {
    return computeAttributeReference(key, value, modelName, schemaInterface);
  }
}

for (let testRun = 0; testRun < 2; testRun++) {
  module(
    `unit/model/reference-array  ${testRun === 0 ? 'old hooks' : 'with computeAttribute'}`,
    function (hooks) {
      setupTest(hooks);

      hooks.beforeEach(function () {
        if (testRun === 0) {
          this.owner.register('service:m3-schema', TestSchemaOldHooks);
        } else if (testRun === 1) {
          this.owner.register('service:m3-schema', TestSchema);
        }
        this.store = this.owner.lookup('service:store');
      });

      test('.unknownProperty resolves arrays of id-matched values', function (assert) {
        let model = run(() => {
          return this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': ['isbn:9780439064873', 'isbn:9780439136365'],
              },
            },
            included: [
              {
                id: 'isbn:9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'isbn:9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
            ],
          });
        });

        assert.ok(
          get(model, 'relatedBooks')._isAllReference,
          'resolved arrays are reference arrays'
        );
        assert.deepEqual(
          get(model, 'relatedBooks').map((x) => get(x, 'name')),
          ['Harry Potter and the Chamber of Secrets', 'Harry Potter and the Prisoner of Azkaban']
        );
      });

      test('.unknownProperty resolves arrays of id-matched values against the global cache', function (assert) {
        let model = run(() => {
          return this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': ['urn:isbn9780439064873', 'urn:isbn9780439136365'],
              },
            },
            included: [
              {
                id: 'urn:isbn9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'urn:isbn9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
            ],
          });
        });

        assert.ok(
          get(model, 'relatedBooks')._isAllReference,
          'resolved arrays are reference arrays'
        );
        assert.deepEqual(
          get(model, 'relatedBooks').map((x) => get(x, 'name')),
          ['Harry Potter and the Chamber of Secrets', 'Harry Potter and the Prisoner of Azkaban']
        );
      });

      test('.unknownProperty resolves reference arrays', function (assert) {
        let model = run(() => {
          return this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*otherBooksInSeries': ['isbn:9780439064873', 'isbn:9780439136365'],
              },
            },
            included: [
              {
                id: 'isbn:9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'isbn:9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
              {
                id: 'isbn:9780439139601',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Goblet of Fire`,
                },
              },
            ],
          });
        });

        let otherBooksInSeries = get(model, 'otherBooksInSeries');
        // so far just like a normal array of references
        assert.deepEqual(
          otherBooksInSeries.mapBy('id'),
          ['isbn:9780439064873', 'isbn:9780439136365'],
          'ref array looks up the referenced objects'
        );

        let chamberOfSecrets = this.store.peekRecord(
          'com.example.bookstore.Book',
          'isbn:9780439064873'
        );
        let gobletOfFire = this.store.peekRecord(
          'com.example.bookstore.Book',
          'isbn:9780439139601'
        );
        run(() => {
          model.set('otherBooksInSeries', [chamberOfSecrets, gobletOfFire]);
        });
        assert.deepEqual(
          get(model, 'otherBooksInSeries').mapBy('id'),
          ['isbn:9780439064873', 'isbn:9780439139601'],
          'ref arrays update on set'
        );
        assert.deepEqual(
          otherBooksInSeries.mapBy('id'),
          ['isbn:9780439064873', 'isbn:9780439139601'],
          'ref arrays can be "set" like @ember-data/model hasMany'
        );

        // Need to rollback to detect the changes from the server
        model.rollbackAttributes();

        run(() => {
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*otherBooksInSeries': ['isbn:9780439136365', 'isbn:9780439358071'],
              },
            },
            included: [
              {
                id: 'isbn:9780439358071',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Order of the Phoenix`,
                },
              },
            ],
          });
        });

        assert.deepEqual(
          get(model, 'otherBooksInSeries').mapBy('id'),
          ['isbn:9780439136365', 'isbn:9780439358071'],
          'ref array properties update from server'
        );
        assert.deepEqual(
          otherBooksInSeries.mapBy('id'),
          ['isbn:9780439136365', 'isbn:9780439358071'],
          'ref arrays update in-place; treated like RecordArrays'
        );
      });

      test('reference arrays act like record arrays - deleted records removed', function (assert) {
        this.owner.register(
          'adapter:-ember-m3',
          EmberObject.extend({
            deleteRecord() {
              return resolve();
            },
          })
        );
        let model = run(() => {
          return this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*otherBooksInSeries': ['isbn:9780439064873', 'isbn:9780439136365'],
              },
            },
            included: [
              {
                id: 'isbn:9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'isbn:9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
            ],
          });
        });

        let otherBooks;

        return run(() => {
          otherBooks = get(model, 'otherBooksInSeries');
          assert.deepEqual(
            otherBooks.mapBy('id'),
            ['isbn:9780439064873', 'isbn:9780439136365'],
            'reference array initially resolved'
          );

          return otherBooks.objectAt(0).destroyRecord();
        }).then(() => {
          assert.strictEqual(get(model, 'otherBooksInSeries'), otherBooks, 'record array re-used');
          assert.deepEqual(
            otherBooks.mapBy('id'),
            ['isbn:9780439136365'],
            'destroyed model removed from existing record arrays'
          );
        });
      });

      test('.setUnknownProperty updates cached RecordArrays in-place for given arrays and RecordArrays', async function (assert) {
        this.store.push({
          data: {
            id: 'isbn:9780439708180',
            type: 'com.example.bookstore.Book',
            attributes: {
              name: `Harry Potter and the Sorcerer's Stone`,
              '*relatedBooks': ['isbn:9780439064873', 'isbn:9780439136365'],
              '*otherRecordArray': [],
            },
          },
          included: [
            {
              id: 'isbn:9780439064873',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Chamber of Secrets`,
              },
            },
            {
              id: 'isbn:9780439136365',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Prisoner of Azkaban`,
              },
            },
          ],
        });

        await settled();
        let model = this.store.peekRecord('com.example.bookstore.Book', 'isbn:9780439708180');

        let relatedBooksRecordArray = get(model, 'relatedBooks');
        let otherRecordArray = get(model, 'otherRecordArray');
        let relatedBooksPlainArray = [
          this.store.peekRecord('com.example.bookstore.Book', 'isbn:9780439136365'),
        ];

        assert.deepEqual(
          relatedBooksRecordArray.map((b) => get(b, 'id')),
          ['isbn:9780439064873', 'isbn:9780439136365'],
          'initially record array has the server-provided values'
        );

        set(model, 'relatedBooks', relatedBooksPlainArray);
        await settled();

        assert.deepEqual(
          get(model, 'relatedBooks').map((b) => get(b, 'id')),
          ['isbn:9780439136365'],
          'existing attr record array is updated in-place from plain array'
        );
        assert.strictEqual(
          get(model, 'relatedBooks'),
          relatedBooksRecordArray,
          'initial record array is re-used from plain array'
        );

        set(model, 'relatedBooks', otherRecordArray);
        await settled();

        assert.deepEqual(
          get(model, 'relatedBooks').map((b) => get(b, 'id')),
          [],
          'existing attr record array is updated in-place from record array'
        );
        assert.strictEqual(
          get(model, 'relatedBooks'),
          relatedBooksRecordArray,
          'initial record array is re-used from record array'
        );

        set(model, 'newRecordArray', relatedBooksRecordArray);
        await settled();

        let otherBook = this.store.peekRecord('com.example.bookstore.Book', 'isbn:9780439064873');
        assert.ok(otherBook, 'loaded book from included');

        otherRecordArray.pushObject(otherBook);
        await settled();

        set(model, 'newRecordArray', otherRecordArray);
        await settled();

        assert.deepEqual(
          get(model, 'newRecordArray').map((b) => get(b, 'id')),
          ['isbn:9780439064873'],
          'new attr record array is updated in place once cached'
        );
        assert.strictEqual(
          get(model, 'newRecordArray'),
          relatedBooksRecordArray,
          'new attr record array is re-used once cached'
        );
      });

      test('BaseRecordArray has length as a property', function (assert) {
        let model = run(() =>
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': ['isbn:9780439064873', 'isbn:9780439136365'],
                '*otherRecordArray': [],
              },
            },
            included: [
              {
                id: 'isbn:9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'isbn:9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
            ],
          })
        );

        let relatedBooks = get(model, 'relatedBooks');
        assert.equal(
          relatedBooks.length,
          2,
          'BaseRecordArray instance returns array length upon just checking length property'
        );
      });

      test('reference array payload can update to undefined', function (assert) {
        let model = run(() => {
          return this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': ['isbn:9780439064873', 'isbn:9780439136365'],
              },
            },
            included: [
              {
                id: 'isbn:9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'isbn:9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
            ],
          });
        });

        assert.deepEqual(
          get(model, 'relatedBooks').map((x) => get(x, 'name')),
          ['Harry Potter and the Chamber of Secrets', 'Harry Potter and the Prisoner of Azkaban']
        );

        run(() => {
          this.store.push({
            data: {
              id: 'isbn:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': undefined,
              },
            },
          });
        });

        assert.deepEqual(
          get(model, 'relatedBooks').map((x) => get(x, 'name')),
          [],
          'array empty'
        );
      });

      test('updated reference arrays resolve their new references lazily when using the global cache', function (assert) {
        let model = run(() => {
          // use obj instead of urn here so `_resolve` puts us in global cache
          // rather than knowing the type from the id
          return this.store.push({
            data: {
              id: 'obj:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': [],
              },
            },
            included: [],
          });
        });

        let relatedBooks = model.get('relatedBooks');
        assert.deepEqual(relatedBooks.mapBy('id'), [], 'record array instantiated');

        run(() => {
          this.store.push({
            data: {
              id: 'record:1',
              type: 'com.example.bookstore.Unrelated',
            },
            included: [
              {
                id: 'obj:9780439708180',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Sorcerer's Stone`,
                  '*relatedBooks': ['obj:9780439064873', 'obj:9780439136365'],
                },
              },
              {
                id: 'obj:9780439064873',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Chamber of Secrets`,
                },
              },
              {
                id: 'obj:9780439136365',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Prisoner of Azkaban`,
                },
              },
            ],
          });
        });

        assert.deepEqual(
          relatedBooks.mapBy('id'),
          ['obj:9780439064873', 'obj:9780439136365'],
          'record array updates references lazily'
        );
      });

      // TODO: add support instead for a missing ref hook #254
      test('reference arrays can point to nonexistant records', function (assert) {
        let model = run(() => {
          // use obj instead of urn here so `_resolve` puts us in global cache
          // rather than knowing the type from the id
          return this.store.push({
            data: {
              id: 'obj:9780439708180',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: `Harry Potter and the Sorcerer's Stone`,
                '*relatedBooks': [],
              },
            },
            included: [],
          });
        });

        let relatedBooks = model.get('relatedBooks');
        assert.deepEqual(relatedBooks.mapBy('id'), [], 'record array instantiated');

        run(() => {
          this.store.push({
            data: {
              id: 'record:1',
              type: 'com.example.bookstore.Unrelated',
            },
            included: [
              {
                id: 'obj:9780439708180',
                type: 'com.example.bookstore.Book',
                attributes: {
                  name: `Harry Potter and the Sorcerer's Stone`,
                  '*relatedBooks': ['obj:9780439064873', 'obj:9780439136365'],
                },
              },
            ],
          });
        });

        assert.deepEqual(
          relatedBooks.toArray(),
          [undefined, undefined],
          'record arrays can refer to records not in store'
        );
      });

      test('The key on the payload can differ from the key on the record', async function (assert) {
        const record = this.store.push({
          data: {
            id: 'urn:bookstore:1',
            type: 'com.example.bookstore.Bookstore',
            attributes: {
              '*elements': ['urn:book:1', 'urn:book:2'],
            },
          },
          included: [
            {
              id: 'urn:book:1',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: 'Book 1!',
              },
            },
            {
              id: 'urn:book:2',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: 'Book 2!',
              },
            },
          ],
        });
        const books = record.get('elements');
        assert.equal(books.length, 2, 'We have two books');
        assert.deepEqual(
          books.map((b) => b.get('name')),
          ['Book 1!', 'Book 2!'],
          'We have the right books'
        );

        this.store.push({
          data: {
            id: 'urn:bookstore:1',
            type: 'com.example.bookstore.Bookstore',
            attributes: {
              '*elements': ['urn:book:1', 'urn:book:3', 'urn:book:4'],
            },
          },
          included: [
            {
              id: 'urn:book:1',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: 'Book 1!',
              },
            },
            {
              id: 'urn:book:3',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: 'Book 3!',
              },
            },
            {
              id: 'urn:book:4',
              type: 'com.example.bookstore.Book',
              attributes: {
                name: 'Book 4!',
              },
            },
          ],
        });

        assert.equal(books.length, 3, 'We updated to 3 books');
        assert.deepEqual(
          books.map((b) => b.get('name')),
          ['Book 1!', 'Book 3!', 'Book 4!'],
          'We have the right books after the update'
        );
      });
    }
  );
}
