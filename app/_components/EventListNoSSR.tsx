"use client";

import dynamic from "next/dynamic";

const EventListClient = dynamic(() => import("./EventListClient"), { ssr: false });

export default EventListClient;
