"use client";

import dynamic from "next/dynamic";

const BottomFilterBar = dynamic(() => import("./BottomFilterBar"), { ssr: false });

export default BottomFilterBar;
