import Viewer from '@/components/viewer';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Viewer id={id}/>;}
