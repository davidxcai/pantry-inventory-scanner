// Integration checks against a DEV/STAGING Supabase project with the watchlist migration applied.
// Creates temporary confirmed UTA users and products; removes all fixtures in finally.
// Required: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY in .env.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (fs.existsSync('.env')) process.loadEnvFile('.env')
const url = process.env.SUPABASE_URL
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY
if (!url || !publicKey || !secretKey) throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY for a dev/staging project.')

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, secretKey, options)
const client = () => createClient(url, publicKey, options)
const users: string[] = []
const products: string[] = []
const stamp = crypto.randomUUID()

async function makeUser(label: string) {
  const email = `watchlist-${label}-${stamp}@mavs.uta.edu`
  const password = `Tmp-${crypto.randomUUID()}!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  users.push(data.user.id)
  const signedIn = client()
  const result = await signedIn.auth.signInWithPassword({ email, password })
  if (result.error) throw result.error
  return { id: data.user.id, client: signedIn }
}

async function main() {
  try {
    const alice = await makeUser('alice')
    const bob = await makeUser('bob')
    for (const category of ['snacks', 'other']) {
      const { data } = await admin.from('items').insert({
        name: `Watchlist Test ${category} ${stamp}`, categories: [category], status: 'out', created_by: alice.id,
      }).select('id').single().throwOnError()
      products.push(data!.id as string)
    }
    const [itemId, hiddenId] = products
    const guest = client()
    const saved = { user_id: alice.id, item_id: itemId }

    assert.ok((await guest.from('watchlist_items').select('*')).error, 'anonymous read must be blocked')
    assert.ok((await guest.from('watchlist_items').insert(saved)).error, 'anonymous save must be blocked')
    assert.ok((await guest.from('watchlist_items').delete().eq('item_id', itemId)).error, 'anonymous delete must be blocked')

    await alice.client.from('watchlist_items').insert(saved).throwOnError()
    await alice.client.from('watchlist_items').upsert(saved, { onConflict: 'user_id,item_id', ignoreDuplicates: true }).throwOnError()
    const own = await alice.client.from('watchlist_items').select('*').throwOnError()
    assert.equal(own.data?.length, 1, 'repeated saves must produce one entry')
    assert.equal(own.data![0].item_id, itemId)
    assert.equal((await bob.client.from('watchlist_items').select('*').throwOnError()).data?.length, 0, 'another user cannot read the list')
    assert.ok((await bob.client.from('watchlist_items').upsert(saved, { onConflict: 'user_id,item_id', ignoreDuplicates: true })).error, 'another user cannot save for Alice, including an existing entry')
    assert.ok((await alice.client.from('watchlist_items').insert({ user_id: alice.id, item_id: hiddenId })).error, 'hidden items cannot be saved')
    assert.ok((await alice.client.from('watchlist_items').insert({ user_id: alice.id, item_id: crypto.randomUUID() })).error, 'unknown items cannot be saved')
    assert.ok((await alice.client.from('watchlist_items').update({ user_id: bob.id }).eq('item_id', itemId)).error, 'ownership cannot be reassigned')

    await bob.client.from('watchlist_items').delete().eq('user_id', alice.id).eq('item_id', itemId).throwOnError()
    assert.equal((await alice.client.from('watchlist_items').select('*').throwOnError()).data?.length, 1, 'another user cannot remove Alice’s entry')
    await bob.client.from('watchlist_items').insert({ user_id: bob.id, item_id: itemId }).throwOnError()
    assert.equal((await bob.client.from('watchlist_items').select('*').throwOnError()).data?.length, 1, 'both users can save the same product independently')

    const item = await admin.from('items').select('status, status_updated_at').eq('id', itemId).single().throwOnError()
    assert.equal(item.data!.status, 'out', 'saving must not change availability')
    assert.equal(item.data!.status_updated_at, null, 'saving must not create a stock report')
    await admin.from('items').update({ status: 'low' }).eq('id', itemId).throwOnError()
    const current = await alice.client.from('available_items').select('availability').eq('id', itemId).single().throwOnError()
    assert.equal(current.data!.availability, 'low', 'saved products use current catalog availability')

    await alice.client.from('watchlist_items').delete().eq('item_id', itemId).throwOnError()
    assert.equal((await alice.client.from('watchlist_items').select('*').throwOnError()).data?.length, 0, 'owner can remove a product')
    assert.equal((await bob.client.from('watchlist_items').select('*').throwOnError()).data?.length, 1, 'removing does not affect another list')

    await admin.from('items').update({ categories: ['other'] }).eq('id', itemId).throwOnError()
    await bob.client.from('watchlist_items').delete().eq('item_id', itemId).throwOnError()
    assert.equal((await bob.client.from('watchlist_items').select('*').throwOnError()).data?.length, 0, 'owner can remove a product after it is hidden')
    await admin.from('items').update({ categories: ['snacks'] }).eq('id', itemId).throwOnError()
    await bob.client.from('watchlist_items').insert({ user_id: bob.id, item_id: itemId }).throwOnError()
    await admin.from('items').delete().eq('id', itemId).throwOnError()
    assert.equal((await bob.client.from('watchlist_items').select('*').throwOnError()).data?.length, 0, 'deleting a product cleans up saved entries')
    console.log('All watchlist integration checks passed.')
  } finally {
    if (products.length) await admin.from('items').delete().in('id', products).throwOnError()
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) { console.error('Could not clean up a test account:', error); process.exitCode = 1 }
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
