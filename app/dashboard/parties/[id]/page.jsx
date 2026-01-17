import React from "react";
import PartyDetailPage from "../components/PartyDetails";

export default async function page(props) {
  const { id } = await props.params;
  return <PartyDetailPage id={id} />;
}
