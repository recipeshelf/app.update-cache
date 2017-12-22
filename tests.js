// tests.js

var _ = require('lodash')
var assert = require('assert')

const fs = require('fs')
const path = require('path')

const AWS = require('aws-sdk-mock')
const AWS_SDK = require('aws-sdk')
AWS.setSDKInstance(AWS_SDK)

AWS.mock('S3', 'getObject', function (params, callback) {
    const file = path.join(__dirname, "testfiles", params.Key)
    callback(null, { Body: fs.readFileSync(file) })
})

const index = require('./index')

const RedisPoco = require('redis-poco')
const RedisPhraseComplete = require('redis-phrase-complete')

const redisPoco = new RedisPoco({ namespace: 'recipe', itemKey: 'item', endpoint: process.env.CACHE_ENDPOINT, attributes: [ 'vegan', 'totalTimeInMinutes', 'approved', 'spiceLevel', 'region', 'cuisine', 'chefId', 'ingredientIds', 'overnightPreparation', 'accompanimentIds', 'collections' ]})
const redisPhraseComplete = new RedisPhraseComplete({ namespace: 'recipe:autocomplete', client: redisPoco.client })

const putEvent = {
    "Records": [
        {
            "eventName": "ObjectCreated:Put",
            "s3": {
                "bucket": {
                    "name": "recipeshelf"
                },
                "object": {
                    "key": "recipes/NXkkUWRu.json"
                }
            }
        },
        {
            "eventName": "ObjectCreated:Put",
            "s3": {
                "bucket": {
                    "name": "recipeshelf"
                },
                "object": {
                    "key": "recipes/3uDSc4Vg.json"
                }
            }
        }
    ]
}

const deleteEvent = {
    "Records": [
        {
            "eventName": "ObjectRemoved:Delete",
            "s3": {
                "bucket": {
                    "name": "recipeshelf"
                },
                "object": {
                    "key": "recipes/3uDSc4Vg.json"
                }
            }
        },
        {
            "eventName": "ObjectRemoved:Delete",
            "s3": {
                "bucket": {
                    "name": "recipeshelf"
                },
                "object": {
                    "key": "recipes/NXkkUWRu.json"
                }
            }
        }
    ]
}

const recipe1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testfiles/recipes/3uDSc4Vg.json')))
const recipe2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'testfiles/recipes/NXkkUWRu.json')))

const whenAssertRecipesAdded = () => {
    return redisPoco.whenGet(recipe1.id)
            .then(recipe => {
                delete recipe.vegan
                assert.deepEqual(recipe, recipe1)
                return Promise.resolve()
            })
            .then(() => redisPoco.whenGet(recipe2.id))
            .then(recipe => {
                delete recipe.vegan
                assert.deepEqual(recipe, recipe2)
                return Promise.resolve()
            })
            .then(() => redisPhraseComplete.whenFind('peanut'))
            .then(ids => {
                assert.deepEqual(ids, ['NXkkUWRu'])
                return Promise.resolve()
            })
}

const whenAssertRecipesRemoved = () => {
    return redisPoco.whenGet(recipe1.id)
            .then(recipe => {
                assert.equal(recipe, null)
                return Promise.resolve()
            })
            .then(() => redisPoco.whenGet(recipe2.id))
            .then(recipe => {
                assert.equal(recipe, null)
                return Promise.resolve()
            })
            .then(() => redisPhraseComplete.whenFind('peanut'))
            .then(ids => {
                assert.deepEqual(ids, [])
                return Promise.resolve()
            })
}

let testMessages = [], tests = []
  
tests.push(index.whenHandler({blah: true})
            .catch(err => {
                testMessages.push('Errors are bubbled up')
                assert.equal(err.message, 'Invalid event - {"blah":true}')
                return Promise.resolve()
            }))

tests.push(redisPoco.whenFlush()
                .then(() => index.whenHandler(putEvent))
                .then(() => {
                    testMessages.push('Add recipes')
                    return whenAssertRecipesAdded()
                })         
                .then(() => index.whenHandler(deleteEvent))
                .then(() => {
                    testMessages.push('Remove recipes')
                    return whenAssertRecipesRemoved()
                })
            )            

Promise.all(tests)
        .then(redisPoco.whenQuit)
        .then(() => {
            console.info(_.map(testMessages, m => m + ' - passed').join('\n'))
            process.exit()
        })


