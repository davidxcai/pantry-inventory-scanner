import { createFileRoute } from '@tanstack/react-router'
import { ProfileScreen } from '../features/profile/ProfileScreen'
export const Route = createFileRoute('/_auth/profile')({
  validateSearch:(search:Record<string,unknown>):{list?:'wishlist'}=>({list:search.list==='wishlist'?'wishlist':undefined}),
  component:SavedProductsPage,
})
function SavedProductsPage(){
  const {list}=Route.useSearch()
  return <ProfileScreen key={list??'saved'} initialTab={list==='wishlist'?'wishlist':'saved'}/>
}
