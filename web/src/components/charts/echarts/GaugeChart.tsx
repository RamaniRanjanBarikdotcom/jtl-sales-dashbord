"use client";

import dynamic from "next/dynamic";
import * as echarts from "echarts";
import { DS } from "@/lib/design-system";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export function GaugeChart({ val, name, target, color }: { val: number, name: string, target?: number, color?: string }) {
    const c1 = color || DS.emerald;
    const option = {
        series: [
            {
                type: 'gauge',
                startAngle: 180,
                endAngle: 0,
                min: 0,
                max: 100,
                splitNumber: 5,
                itemStyle: { color: c1 },
                progress: {
                    show: true,
                    width: 14,
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                            { offset: 0, color: DS.sky },
                            { offset: 1, color: c1 }
                        ])
                    }
                },
                pointer: { show: false },
                axisLine: {
                    lineStyle: {
                        width: 14,
                        color: [[1, "rgba(255,255,255,0.05)"]]
                    }
                },
                axisTick: { show: false },
                splitLine: { show: false },
                axisLabel: { show: false },
                title: {
                    show: true,
                    offsetCenter: [0, '20%'],
                    color: DS.lo,
                    fontSize: 10,
                    fontFamily: DS.mono,
                },
                detail: {
                    valueAnimation: true,
                    formatter: '{value}%',
                    color: DS.hi,
                    fontSize: 24,
                    fontFamily: DS.display,
                    offsetCenter: [0, '-10%']
                },
                data: [{ value: val, name: name }]
            }
        ]
    };

    return <ReactECharts option={option} style={{ height: "100%", width: "100%" }} />;
}
