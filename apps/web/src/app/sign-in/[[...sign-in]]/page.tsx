import { SignIn } from "@clerk/nextjs";
export default function Page() { return <main className="shell" style={{display:"grid",placeItems:"center",minHeight:"100vh"}}><SignIn /></main>; }