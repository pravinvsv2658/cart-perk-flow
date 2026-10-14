import { redirect, type LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    return redirect(`/app/free-shipping-bar?id=${id}`);
  }
  return redirect("/app/free-shipping-bar");
};

export default function IntegrationRedirect() {
  return null;
}
