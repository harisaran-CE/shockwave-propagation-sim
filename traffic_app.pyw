"""Friendly desktop front end for the project's 1D traffic-flow model."""

from __future__ import annotations

import csv
import bisect
import json
import secrets
import time
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import numpy as np
import traffic_sim


APP_TITLE = "Flowline Traffic Studio"


class _XorShift32:
    """Small reproducible random stream shared with the browser build."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF or 1

    def random(self) -> float:
        value = self.state
        value ^= (value << 13) & 0xFFFFFFFF
        value ^= value >> 17
        value ^= (value << 5) & 0xFFFFFFFF
        self.state = value & 0xFFFFFFFF or 1
        return self.state / 0x100000000


COLORS = {
    "page": "#f3f5f2",
    "surface": "#ffffff",
    "ink": "#26343a",
    "muted": "#627078",
    "line": "#dce4e0",
    "blue": "#286d72",
    "blue_dark": "#20585c",
    "blue_pale": "#e8f1ef",
    "green": "#39836d",
    "amber": "#bf7626",
    "red": "#c85f55",
    "plot": "#f7f9f7",
}


class FlowlineApp(tk.Tk):
    """A guided, non-terminal interface to the 1D traffic simulation."""

    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1240x850")
        self.minsize(1050, 760)
        self.configure(bg=COLORS["page"])

        self.history: list[traffic_sim.SimulationState] = []
        self.current_step = 0
        self.playback_position = 0.0
        self._last_playback_tick: float | None = None
        self.playing = False
        self.after_id: str | None = None
        self.is_scrubbing = False

        self.speed_var = tk.StringVar(value="1x")
        self.demand_var = tk.StringVar(value="1200")
        self.inflow_variability_var = tk.StringVar(value="25")
        self.run_inflow_variability_percent = 25
        self.run_inflow_seed = 0
        self.closure_position_var = tk.StringVar(value="805")
        self.closure_reduction_var = tk.StringVar(value="100% — fully closed")
        self.duration_var = tk.StringVar(value="3 minutes")
        self.time_var = tk.StringVar(value="0.00 s")
        self.mass_var = tk.StringVar(value="—")
        self.density_var = tk.StringVar(value="—")
        self.speed_metric_var = tk.StringVar(value="—")
        self.flow_var = tk.StringVar(value="—")
        self.summary_var = tk.StringVar(value="Run the demo to see how a road closure changes traffic.")
        self.progress_var = tk.StringVar(value="Ready when you are")
        self.run_config = traffic_sim.SimulationConfig()
        self.total_steps = traffic_sim.TOTAL_DURATION

        self._setup_styles()
        self._build_layout()
        self._show_initial_state()

    def _setup_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(
            "TCombobox",
            fieldbackground=COLORS["surface"],
            background=COLORS["surface"],
            foreground=COLORS["ink"],
            arrowcolor=COLORS["muted"],
            padding=(9, 8),
            bordercolor=COLORS["line"],
        )
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", COLORS["surface"])],
            foreground=[("readonly", COLORS["ink"])],
        )
        style.configure(
            "TSpinbox",
            fieldbackground=COLORS["surface"],
            background=COLORS["surface"],
            foreground=COLORS["ink"],
            arrowcolor=COLORS["muted"],
            padding=(7, 5),
            bordercolor=COLORS["line"],
        )
        style.configure(
            "TButton",
            background=COLORS["surface"],
            foreground=COLORS["ink"],
            padding=(10, 7),
            bordercolor=COLORS["line"],
        )
        style.configure(
            "Timeline.Horizontal.TScale",
            background=COLORS["surface"],
            troughcolor="#e3e9e5",
        )

    def _panel(self, parent: tk.Widget, **grid_options: object) -> tk.Frame:
        panel = tk.Frame(
            parent,
            bg=COLORS["surface"],
            highlightbackground=COLORS["line"],
            highlightthickness=1,
        )
        panel.grid(**grid_options)
        return panel

    @staticmethod
    def _label(
        parent: tk.Widget,
        text: str = "",
        *,
        font: tuple[object, ...] = ("Segoe UI", 10),
        color: str = COLORS["ink"],
        bg: str = COLORS["surface"],
        **options: object,
    ) -> tk.Label:
        return tk.Label(parent, text=text, font=font, fg=color, bg=bg, **options)

    def _build_layout(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = tk.Frame(self, bg=COLORS["page"])
        header.grid(row=0, column=0, sticky="ew", padx=30, pady=(22, 16))
        logo = tk.Canvas(header, width=42, height=42, bg=COLORS["blue"], highlightthickness=0)
        logo.create_line(7, 29, 17, 18, 24, 25, 35, 10, fill="white", width=3, smooth=True)
        logo.create_oval(31, 6, 38, 13, fill="white", outline="")
        logo.pack(side="left", padx=(0, 12))
        text_block = tk.Frame(header, bg=COLORS["page"])
        text_block.pack(side="left", anchor="w")
        self._label(text_block, "Flowline", font=("Segoe UI", 20, "bold"), bg=COLORS["page"]).pack(anchor="w")
        self._label(
            text_block,
            "Traffic Studio  ·  Explore how congestion moves",
            font=("Segoe UI", 9),
            color=COLORS["muted"],
            bg=COLORS["page"],
        ).pack(anchor="w", pady=(1, 0))
        self._label(
            header,
            "TRAFFIC MODEL",
            font=("Segoe UI", 8, "bold"),
            color=COLORS["blue"],
            bg=COLORS["blue_pale"],
            padx=11,
            pady=7,
        ).pack(side="right", anchor="center")

        content = tk.Frame(self, bg=COLORS["page"])
        content.grid(row=1, column=0, sticky="nsew", padx=30, pady=(0, 16))
        content.grid_columnconfigure(1, weight=1)
        content.grid_rowconfigure(0, weight=1)

        self._build_sidebar(content)
        self._build_dashboard(content)

        footer = tk.Frame(self, bg=COLORS["page"])
        footer.grid(row=2, column=0, sticky="ew", padx=30, pady=(0, 16))
        self._label(
            footer,
            "Model view: each color block shows average traffic density along the 1 km road—not individual cars.",
            font=("Segoe UI", 8),
            color=COLORS["muted"],
            bg=COLORS["page"],
        ).pack(side="left")
        self._label(
            footer,
            "Playback speed changes viewing only; the model time step stays fixed.",
            font=("Segoe UI", 8),
            color=COLORS["muted"],
            bg=COLORS["page"],
        ).pack(side="right")

    def _build_sidebar(self, parent: tk.Frame) -> None:
        sidebar = tk.Frame(parent, bg=COLORS["page"], width=280)
        sidebar.grid(row=0, column=0, sticky="nsw", padx=(0, 16))
        sidebar.grid_propagate(False)

        intro = self._panel(sidebar)
        intro.pack(fill="x", pady=(0, 12))
        self._label(intro, "Set up a run", font=("Segoe UI", 14, "bold")).pack(
            anchor="w", padx=17, pady=(17, 5)
        )
        self._label(
            intro,
            "Change the traffic and road settings below, then run the simulation.",
            font=("Segoe UI", 9),
            color=COLORS["muted"],
            justify="left",
            wraplength=235,
        ).pack(anchor="w", padx=17, pady=(0, 15))

        scenario = self._panel(sidebar)
        scenario.pack(fill="x", pady=(0, 12))
        self._label(scenario, "SCENARIO SETTINGS", font=("Segoe UI", 8, "bold"), color=COLORS["muted"]).pack(
            anchor="w", padx=17, pady=(15, 10)
        )
        self._scenario_field(scenario, "Arriving traffic", "Passenger-car units per hour", self.demand_var,
                             from_=0, to=3000, increment=50, suffix="PCU/h")
        self._scenario_field(scenario, "Inflow variability", "Random range around the average each second", self.inflow_variability_var,
                             from_=0, to=50, increment=5, suffix="±%")
        self._scenario_field(scenario, "Road restriction at", "Distance from the start", self.closure_position_var,
                             from_=50, to=950, increment=5, suffix="m")

        self._label(scenario, "Capacity reduction", font=("Segoe UI", 9, "bold")).pack(
            anchor="w", padx=17, pady=(8, 2)
        )
        self._label(scenario, "How much the restriction limits flow", font=("Segoe UI", 8), color=COLORS["muted"]).pack(
            anchor="w", padx=17, pady=(0, 5)
        )
        ttk.Combobox(
            scenario,
            textvariable=self.closure_reduction_var,
            values=("0% — no restriction", "25% — light restriction", "50% — half closed", "75% — severe restriction", "100% — fully closed"),
            state="readonly",
        ).pack(fill="x", padx=17, pady=(0, 10))

        self._label(scenario, "Run length", font=("Segoe UI", 9, "bold")).pack(
            anchor="w", padx=17, pady=(3, 2)
        )
        ttk.Combobox(
            scenario,
            textvariable=self.duration_var,
            values=("1 minute", "2 minutes", "3 minutes", "5 minutes"),
            state="readonly",
        ).pack(fill="x", padx=17, pady=(0, 15))

        actions = self._panel(sidebar)
        actions.pack(fill="x", pady=(0, 12))
        self.run_button = tk.Button(
            actions,
            text="Run simulation",
            command=self.run_simulation,
            bg=COLORS["blue"],
            activebackground=COLORS["blue_dark"],
            activeforeground="white",
            fg="white",
            relief="flat",
            bd=0,
            cursor="hand2",
            font=("Segoe UI", 10, "bold"),
            padx=14,
            pady=11,
        )
        self.run_button.pack(fill="x", padx=14, pady=(15, 8))
        self.run_button.bind("<Enter>", lambda _event: self.run_button.configure(bg=COLORS["blue_dark"]))
        self.run_button.bind("<Leave>", lambda _event: self.run_button.configure(bg=COLORS["blue"]))
        ttk.Button(actions, text="Start over", command=self.reset).pack(fill="x", padx=14, pady=(0, 14))

        export = self._panel(sidebar)
        export.pack(fill="x")
        self._label(export, "TAKE YOUR RESULTS", font=("Segoe UI", 8, "bold"), color=COLORS["muted"]).pack(
            anchor="w", padx=17, pady=(15, 7)
        )
        self.csv_button = ttk.Button(export, text="Save data as CSV…", command=self.export_csv, state="disabled")
        self.csv_button.pack(fill="x", padx=14, pady=(0, 7))
        self.json_button = ttk.Button(export, text="Save full run as JSON…", command=self.export_json, state="disabled")
        self.json_button.pack(fill="x", padx=14, pady=(0, 13))

    def _scenario_field(
        self,
        parent: tk.Frame,
        title: str,
        subtitle: str,
        variable: tk.StringVar,
        *,
        from_: int,
        to: int,
        increment: int,
        suffix: str,
    ) -> None:
        self._label(parent, title, font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=17, pady=(3, 2))
        self._label(parent, subtitle, font=("Segoe UI", 8), color=COLORS["muted"]).pack(anchor="w", padx=17, pady=(0, 5))
        row = tk.Frame(parent, bg=COLORS["surface"])
        row.pack(fill="x", padx=17, pady=(0, 10))
        ttk.Spinbox(
            row,
            textvariable=variable,
            from_=from_,
            to=to,
            increment=increment,
            width=9,
            justify="right",
        ).pack(side="left")
        self._label(row, suffix, font=("Segoe UI", 8), color=COLORS["muted"]).pack(side="left", padx=(7, 0))

    def _build_dashboard(self, parent: tk.Frame) -> None:
        dashboard = tk.Frame(parent, bg=COLORS["page"])
        dashboard.grid(row=0, column=1, sticky="nsew")
        dashboard.grid_columnconfigure(0, weight=1)

        metrics = tk.Frame(dashboard, bg=COLORS["page"])
        metrics.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        for column in range(5):
            metrics.grid_columnconfigure(column, weight=1, uniform="metric")
        self._metric_card(metrics, "SIMULATION TIME", self.time_var, "s")
        self._metric_card(metrics, "VEHICLES ON ROAD", self.mass_var, "PCU")
        self._metric_card(metrics, "MEAN DENSITY", self.density_var, "PCU/km")
        self._metric_card(metrics, "AVERAGE SPEED", self.speed_metric_var, "km/h")
        self._metric_card(metrics, "AVERAGE FLOW", self.flow_var, "PCU/h")

        road_panel = self._panel(dashboard)
        road_panel.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        self._panel_heading(road_panel, "Traffic along the road", "Warm colors indicate heavier traffic")
        self.road_canvas = tk.Canvas(road_panel, height=190, bg=COLORS["surface"], highlightthickness=0)
        self.road_canvas.pack(fill="x", padx=18, pady=(0, 12))
        self.road_canvas.bind("<Configure>", lambda _event: self._draw_road())

        chart_panel = self._panel(dashboard)
        chart_panel.grid(row=2, column=0, sticky="nsew", pady=(0, 12))
        dashboard.grid_rowconfigure(2, weight=1)
        self._panel_heading(chart_panel, "What is changing?", "Vehicles accumulating on the road")
        self.chart_canvas = tk.Canvas(chart_panel, height=190, bg=COLORS["surface"], highlightthickness=0)
        self.chart_canvas.pack(fill="both", expand=True, padx=18, pady=(0, 8))
        self.chart_canvas.bind("<Configure>", lambda _event: self._draw_chart())

        summary = self._panel(dashboard)
        summary.grid(row=3, column=0, sticky="ew")
        badge = tk.Canvas(summary, width=30, height=30, bg=COLORS["blue_pale"], highlightthickness=0)
        badge.create_text(15, 15, text="i", fill=COLORS["blue"], font=("Segoe UI", 15, "bold"))
        badge.pack(side="left", padx=(15, 10), pady=12)
        self._label(
            summary,
            textvariable=self.summary_var,
            font=("Segoe UI", 9),
            color=COLORS["ink"],
            justify="left",
            wraplength=680,
        ).pack(side="left", fill="x", expand=True, padx=(0, 12), pady=12)

        timeline_panel = self._panel(dashboard)
        timeline_panel.grid(row=4, column=0, sticky="ew", pady=(12, 0))
        timeline_panel.grid_columnconfigure(0, weight=1)
        line = tk.Frame(timeline_panel, bg=COLORS["surface"])
        line.grid(row=0, column=0, sticky="ew", padx=16, pady=(12, 10))
        line.grid_columnconfigure(1, weight=1)
        self.play_button = ttk.Button(line, text="▶  Play", command=self.toggle_playback, state="disabled")
        self.play_button.grid(row=0, column=0, padx=(0, 13))
        self.timeline = ttk.Scale(
            line,
            from_=0,
            to=traffic_sim.TOTAL_DURATION,
            command=self.scrub_to,
            style="Timeline.Horizontal.TScale",
        )
        self.timeline.grid(row=0, column=1, sticky="ew")
        self.timeline.bind("<ButtonPress-1>", self._begin_scrub)
        self.timeline.bind("<ButtonRelease-1>", self._end_scrub)
        self.time_readout = self._label(line, "00:00 / 03:00", font=("Segoe UI", 9, "bold"), color=COLORS["muted"])
        self.time_readout.grid(row=0, column=2, padx=(13, 15))
        ttk.Label(line, text="Speed", font=("Segoe UI", 9)).grid(row=0, column=3, padx=(0, 6))
        speed_box = ttk.Combobox(
            line,
            textvariable=self.speed_var,
            values=("0.25x", "0.5x", "0.75x", "1x", "2x", "3x"),
            width=7,
            state="readonly",
        )
        speed_box.grid(row=0, column=4)
        speed_box.bind("<<ComboboxSelected>>", lambda _event: self._restart_if_playing())
        self._label(timeline_panel, textvariable=self.progress_var, font=("Segoe UI", 8), color=COLORS["muted"]).grid(
            row=1, column=0, sticky="w", padx=17, pady=(0, 10)
        )

    def _metric_card(self, parent: tk.Frame, title: str, variable: tk.StringVar, unit: str) -> None:
        card = self._panel(parent)
        column = len(parent.grid_slaves())
        card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 8, 0))
        self._label(card, title, font=("Segoe UI", 9, "bold"), color=COLORS["muted"]).pack(
            anchor="w", padx=13, pady=(12, 2)
        )
        row = tk.Frame(card, bg=COLORS["surface"])
        row.pack(anchor="w", padx=13, pady=(0, 12))
        self._label(row, textvariable=variable, font=("Segoe UI", 15, "bold")).pack(side="left")
        if unit:
            self._label(row, unit, font=("Segoe UI", 8), color=COLORS["muted"]).pack(side="left", padx=(4, 0), pady=(6, 0))

    def _panel_heading(self, panel: tk.Frame, title: str, subtitle: str) -> None:
        header = tk.Frame(panel, bg=COLORS["surface"])
        header.pack(fill="x", padx=18, pady=(14, 9))
        self._label(header, title, font=("Segoe UI", 12, "bold")).pack(side="left")
        self._label(header, subtitle, font=("Segoe UI", 8), color=COLORS["muted"]).pack(side="right")

    def _selected_config(self) -> traffic_sim.SimulationConfig:
        demand = int(self.demand_var.get())
        position = float(self.closure_position_var.get())
        reduction = int(self.closure_reduction_var.get().split("%", 1)[0])
        if not 0 <= demand <= 3000:
            raise ValueError("Arriving traffic must be between 0 and 3,000 PCU/h.")
        if not 50 <= position <= 950:
            raise ValueError("Choose a restriction location between 50 m and 950 m.")
        variability = int(self.inflow_variability_var.get())
        if not 0 <= variability <= 50:
            raise ValueError("Inflow variability must be between 0% and 50%.")
        config = traffic_sim.SimulationConfig(
            inflow_demand_vehicles_per_s=demand / 3600.0,
            bottleneck_position_m=position,
            lane_reduction=reduction / 100.0,
        )
        traffic_sim.validate_configuration(config)
        return config

    def _show_initial_state(self) -> None:
        try:
            self.run_config = self._selected_config()
        except (TypeError, ValueError):
            self.run_config = traffic_sim.SimulationConfig()
        initial = traffic_sim.initialize_state(self.run_config)
        self._update_metrics(initial)
        self._draw_road(initial)
        self._draw_chart()

    def run_simulation(self) -> None:
        self.pause()
        try:
            config = self._selected_config()
            duration_minutes = int(self.duration_var.get().split(" ", 1)[0])
            self.total_steps = round(duration_minutes * 60 / config.time_step_s)
            traffic_sim.validate_configuration(config)
        except (TypeError, ValueError) as error:
            messagebox.showwarning(APP_TITLE, str(error), parent=self)
            return

        self.run_config = config
        self.run_inflow_variability_percent = int(self.inflow_variability_var.get())
        self.run_inflow_seed = secrets.randbits(32) or 1
        self.run_button.configure(state="disabled", text="Running…")
        self.progress_var.set(f"Calculating your {duration_minutes}-minute scenario…")
        self.update_idletasks()
        try:
            random_stream = _XorShift32(self.run_inflow_seed)
            variability = self.run_inflow_variability_percent / 100.0
            sample_steps = max(1, round(1.0 / config.time_step_s))

            def sample_inflow_demand() -> float:
                return config.inflow_demand_vehicles_per_s * (
                    1.0 + (2.0 * random_stream.random() - 1.0) * variability
                )

            state = traffic_sim.initialize_state(config)
            state.inflow_demand_vehicles_per_s = np.longdouble(str(sample_inflow_demand()))
            states = [state]
            for step in range(self.total_steps):
                state = traffic_sim.advance_state(
                    state,
                    inflow_demand_vehicles_per_s=state.inflow_demand_vehicles_per_s,
                )
                if (step + 1) % sample_steps == 0 and step + 1 < self.total_steps:
                    state.inflow_demand_vehicles_per_s = np.longdouble(str(sample_inflow_demand()))
                states.append(state)
                if step and step % 120 == 0:
                    self.progress_var.set(f"Calculating… {step * config.time_step_s:.0f} of {duration_minutes * 60} seconds")
                    self.update_idletasks()
            self.history = states
            self.current_step = 0
            self.playback_position = 0.0
            self.timeline.configure(to=self.total_steps)
            self.timeline.set(0)
            self.play_button.configure(state="normal")
            self.csv_button.configure(state="normal")
            self.json_button.configure(state="normal")
            self.progress_var.set("Your run is ready · use Play or drag the timeline to explore")
            self._render_frame()
        except Exception as error:
            self.progress_var.set("The simulation could not be completed")
            messagebox.showerror(APP_TITLE, f"The simulation could not be completed.\n\n{error}", parent=self)
        finally:
            self.run_button.configure(state="normal", text="Run simulation")

    def reset(self) -> None:
        self.pause()
        self.history = []
        self.current_step = 0
        self.playback_position = 0.0
        self.timeline.set(0)
        self.play_button.configure(state="disabled", text="▶  Play")
        self.csv_button.configure(state="disabled")
        self.json_button.configure(state="disabled")
        self.progress_var.set("Ready when you are")
        self.summary_var.set("Set your scenario, then run it to see how the traffic changes.")
        self._show_initial_state()

    def toggle_playback(self) -> None:
        if self.playing:
            self.pause()
        else:
            self.play()

    def play(self) -> None:
        if not self.history or self.playback_position >= len(self.history) - 1:
            return
        self.playing = True
        self._last_playback_tick = time.perf_counter()
        self.play_button.configure(text="❚❚  Pause")
        self.after_id = self.after(33, self._play_next_frame)

    def pause(self) -> None:
        self.playing = False
        if hasattr(self, "play_button"):
            state = "normal" if self.history else "disabled"
            self.play_button.configure(text="▶  Play", state=state)
        if self.after_id is not None:
            self.after_cancel(self.after_id)
            self.after_id = None

    def _play_next_frame(self) -> None:
        if not self.playing:
            return
        now = time.perf_counter()
        elapsed = max(0.0, now - (self._last_playback_tick or now))
        self._last_playback_tick = now
        scale = {"0.25x": 0.25, "0.5x": 0.5, "0.75x": 0.75, "1x": 1.0, "2x": 2.0, "3x": 3.0}[self.speed_var.get()]
        self.playback_position += elapsed * scale / self.run_config.time_step_s
        final_position = len(self.history) - 1
        if self.playback_position >= final_position:
            self.playback_position = float(final_position)
        previous_step = self.current_step
        self.current_step = min(int(self.playback_position), final_position)
        display_state = self._state_at_position(self.playback_position)
        self.timeline.set(self.playback_position)
        self._render_frame(display_state, update_chart=self.current_step != previous_step)
        if self.playback_position >= final_position:
            self.pause()
            return
        self.after_id = self.after(33, self._play_next_frame)

    def _restart_if_playing(self) -> None:
        if self.playing:
            self.pause()
            self.play()

    def _begin_scrub(self, _event: tk.Event) -> None:
        self.is_scrubbing = True
        self.pause()

    def _end_scrub(self, _event: tk.Event) -> None:
        self.is_scrubbing = False

    def scrub_to(self, raw_step: str) -> None:
        if not self.history or self.playing:
            return
        step = max(0, min(len(self.history) - 1, round(float(raw_step))))
        if step != self.current_step or self.playback_position != float(step):
            self.current_step = step
            self.playback_position = float(step)
            self._render_frame()

    def _state_at_position(self, position: float) -> traffic_sim.SimulationState:
        """Interpolate a display snapshot between adjacent solver states."""

        position = max(0.0, min(len(self.history) - 1, position))
        lower = int(position)
        upper = min(lower + 1, len(self.history) - 1)
        fraction = np.longdouble(str(position - lower))
        if fraction == 0 or upper == lower:
            return self.history[lower]

        first = self.history[lower]
        second = self.history[upper]
        first_inflow = first.inflow_demand_vehicles_per_s
        second_inflow = second.inflow_demand_vehicles_per_s
        if first_inflow is None:
            first_inflow = np.longdouble(str(first.config.inflow_demand_vehicles_per_s))
        if second_inflow is None:
            second_inflow = np.longdouble(str(second.config.inflow_demand_vehicles_per_s))
        return traffic_sim.SimulationState(
            time_s=first.time_s + (second.time_s - first.time_s) * fraction,
            density_vehicles_per_m=first.density_vehicles_per_m + (
                second.density_vehicles_per_m - first.density_vehicles_per_m
            ) * fraction,
            cell_edges_m=first.cell_edges_m,
            config=first.config,
            cumulative_inflow_vehicles=first.cumulative_inflow_vehicles + (
                second.cumulative_inflow_vehicles - first.cumulative_inflow_vehicles
            ) * fraction,
            inflow_demand_vehicles_per_s=first_inflow + (second_inflow - first_inflow) * fraction,
        )

    def _render_frame(
        self,
        state: traffic_sim.SimulationState | None = None,
        *,
        update_chart: bool = True,
    ) -> None:
        if not self.history:
            return
        state = state or self.history[self.current_step]
        self._update_metrics(state)
        self._draw_road(state)
        if update_chart:
            self._draw_chart()
        seconds = float(state.time_s)
        total_seconds = float(self.history[-1].time_s)
        self.time_readout.configure(text=f"{self._format_time(seconds)} / {self._format_time(total_seconds)}")
        self.progress_var.set(f"Frame {self.current_step:,} of {len(self.history) - 1:,} · simulated time {seconds:.2f} s")
        initial_mass = float(self.history[0].vehicle_mass)
        current_mass = float(state.vehicle_mass)
        if current_mass > initial_mass + 0.01:
            self.summary_var.set(
                f"Traffic is building up: the road restriction limits flow, "
                f"so about {current_mass - initial_mass:.1f} additional PCU have accumulated on this 1 km section."
            )
        else:
            self.summary_var.set("Traffic has not built up yet. Use Play to watch the scenario unfold over time.")

    @staticmethod
    def _format_time(seconds: float) -> str:
        whole_seconds = int(seconds)
        return f"{whole_seconds // 60:02d}:{whole_seconds % 60:02d}"

    def _update_metrics(self, state: traffic_sim.SimulationState) -> None:
        metrics = traffic_sim.metrics_snapshot(state)
        self.time_var.set(f"{float(metrics['time_s']):.1f}")
        self.mass_var.set(f"{float(metrics['vehicle_mass']):.1f}")
        self.density_var.set(f"{float(metrics['mean_density_pcu_per_km']):.1f}")
        self.speed_metric_var.set(f"{float(metrics['mean_speed_km_per_h']):.1f}")
        self.flow_var.set(f"{float(metrics['mean_flow_pcu_per_h']):.0f}")

    def _draw_road(self, state: traffic_sim.SimulationState | None = None) -> None:
        if not hasattr(self, "road_canvas"):
            return
        canvas = self.road_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 600)
        left, right = 42, width - 42
        road_top, road_bottom = 49, 133
        if state is None:
            state = (
                self._state_at_position(self.playback_position)
                if self.history
                else traffic_sim.initialize_state(self.run_config)
            )
        edges = state.cell_edges_m
        densities = state.density_vehicles_per_m
        canvas.create_text(left, 22, text="START", anchor="w", fill=COLORS["muted"], font=("Segoe UI", 8, "bold"))
        canvas.create_text(right, 22, text="ROAD END", anchor="e", fill=COLORS["muted"], font=("Segoe UI", 8, "bold"))
        canvas.create_rectangle(left, road_top, right, road_bottom, fill="#59646a", outline="")
        canvas.create_line(left, 91, right, 91, fill="#d8c99e", dash=(12, 9), width=2)
        canvas.create_line(left, road_top + 5, right, road_top + 5, fill="#899397", width=1)
        canvas.create_line(left, road_bottom - 5, right, road_bottom - 5, fill="#899397", width=1)

        # Keep each displayed marker attached to a fixed parcel of mass. The
        # old per-frame quantiles rescaled every marker whenever total mass
        # changed, making cars jump across a full closure and snap back.
        cumulative_mass = []
        running_mass = 0.0
        for cell, density in enumerate(densities):
            running_mass += float(density) * float(edges[cell + 1] - edges[cell])
            cumulative_mass.append(running_mass)

        total_mass = max(0.0, float(state.vehicle_mass))
        initial_state = self.history[0] if self.history else state
        initial_mass = max(0.0, float(initial_state.vehicle_mass))
        initial_marker_count = min(160, int(round(initial_mass)))
        inflow_mass = max(0.0, float(state.cumulative_inflow_vehicles))
        inflow_marker_count = min(160 - initial_marker_count, int(inflow_mass + 0.5))
        marker_ranks = [
            ((marker + 0.5) * initial_mass / initial_marker_count + inflow_mass, marker)
            for marker in range(initial_marker_count)
        ] if initial_marker_count else []
        marker_ranks.extend(
            (inflow_mass - (marker + 0.5), initial_marker_count + marker)
            for marker in range(inflow_marker_count)
        )

        bottleneck = traffic_sim._bottleneck_index(state.config)
        closure_x = left + float(edges[bottleneck]) / state.config.road_length_m * (right - left)
        upstream_mass_at_closure = cumulative_mass[bottleneck - 1] if bottleneck > 0 else 0.0
        positioned_markers = []
        for target_mass, marker in marker_ranks:
            if target_mass < 0.0 or target_mass > total_mass + 1e-8:
                continue
            cell = min(bisect.bisect_right(cumulative_mass, target_mass), len(densities) - 1)
            previous_mass = cumulative_mass[cell - 1] if cell else 0.0
            density = float(densities[cell])
            if density <= 0.0:
                continue
            position_m = float(edges[cell]) + (target_mass - previous_mass) / density
            position_m = min(float(edges[cell + 1]), max(float(edges[cell]), position_m))
            x = left + position_m / state.config.road_length_m * (right - left)
            side = "upstream" if target_mass <= upstream_mass_at_closure else "downstream"
            if state.config.lane_reduction >= 1.0:
                # Keep the full car body on its side of a complete closure.
                if target_mass <= upstream_mass_at_closure:
                    x = min(x, closure_x - 11)
                else:
                    x = max(x, closure_x + 11)
            x = min(right - 6, max(left + 6, x))
            positioned_markers.append((x, marker, side))

        is_fully_blocked = state.config.lane_reduction >= 1.0
        groups: dict[tuple[int, str], list[tuple[float, int, str]]] = {}
        for positioned_marker in positioned_markers:
            x, marker, side = positioned_marker
            key = (marker % 2, side if is_fully_blocked else "road")
            groups.setdefault(key, []).append((x, marker, side))

        visible_markers = []
        for (_lane, group_side), group in groups.items():
            group.sort(key=lambda item: (item[0], item[1]))
            minimum_x = closure_x + 11 if is_fully_blocked and group_side == "downstream" else left + 6
            maximum_x = closure_x - 11 if is_fully_blocked and group_side == "upstream" else right - 6
            gap = 18
            adjusted_x = []
            for index, (desired_x, _marker, _side) in enumerate(group):
                adjusted_x.append(max(minimum_x, desired_x, adjusted_x[-1] + gap if adjusted_x else minimum_x))
            if adjusted_x and adjusted_x[-1] > maximum_x:
                adjusted_x[-1] = maximum_x
                for index in range(len(adjusted_x) - 2, -1, -1):
                    adjusted_x[index] = min(adjusted_x[index], adjusted_x[index + 1] - gap)
            for (_desired_x, marker, side), x in zip(group, adjusted_x):
                visible_markers.append((x, marker, side))

        marker_count = 0
        for x, marker, _side in visible_markers:
            lane = marker % 2
            y = 68 if lane == 0 else 113
            body = "#a9d8c4" if marker % 3 else "#f2f3ed"
            canvas.create_rectangle(x - 6, y - 4, x + 6, y + 4, fill=body, outline="#182235", width=1)
            canvas.create_rectangle(x - 3, y - 3, x + 3, y, fill="#b9e2ff", outline="")
            canvas.create_oval(x - 4, y + 2, x - 2, y + 4, fill="#111827", outline="")
            canvas.create_oval(x + 2, y + 2, x + 4, y + 4, fill="#111827", outline="")
            marker_count += 1

        if state.config.lane_reduction > 0:
            canvas.create_rectangle(closure_x - 4, road_top - 7, closure_x + 4, road_bottom + 7, fill=COLORS["amber"], outline="white", width=1)
            for stripe_y in range(road_top - 4, road_bottom + 4, 12):
                canvas.create_line(closure_x - 3, stripe_y + 6, closure_x + 3, stripe_y, fill="white", width=2)
            canvas.create_text(closure_x, 155, text=f"Restriction: {state.config.bottleneck_position_m:.0f} m", fill=COLORS["amber"], font=("Segoe UI", 8, "bold"))
        canvas.create_text(left, 155, text=f"{marker_count} car markers shown", anchor="w", fill=COLORS["muted"], font=("Segoe UI", 8))
        canvas.create_text(
            (left + right) / 2,
            177,
            text="Car positions visualize traffic density; the physics model tracks continuous traffic flow.",
            fill=COLORS["muted"],
            font=("Segoe UI", 8),
        )

    @staticmethod
    def _density_color(ratio: float) -> str:
        ratio = max(0.0, min(1.0, ratio))
        if ratio < 0.45:
            blend = ratio / 0.45
            return FlowlineApp._mix_color("#8fe0c0", "#f5cd6b", blend)
        blend = (ratio - 0.45) / 0.55
        return FlowlineApp._mix_color("#f5cd6b", "#eb6f73", blend)

    @staticmethod
    def _mix_color(start: str, end: str, fraction: float) -> str:
        start_rgb = tuple(int(start[index : index + 2], 16) for index in (1, 3, 5))
        end_rgb = tuple(int(end[index : index + 2], 16) for index in (1, 3, 5))
        channels = tuple(round(a + (b - a) * fraction) for a, b in zip(start_rgb, end_rgb))
        return "#" + "".join(f"{channel:02x}" for channel in channels)

    def _draw_chart(self) -> None:
        if not hasattr(self, "chart_canvas"):
            return
        canvas = self.chart_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 500)
        height = max(canvas.winfo_height(), 165)
        left, right, top, bottom = 54, width - 16, 12, height - 28
        canvas.create_rectangle(left, top, right, bottom, fill=COLORS["plot"], outline="")
        if not self.history:
            canvas.create_text(
                (left + right) / 2,
                (top + bottom) / 2,
                text="Your traffic build-up chart will appear here after you run a simulation.",
                fill=COLORS["muted"],
                font=("Segoe UI", 9),
            )
            return

        masses = [float(state.vehicle_mass) for state in self.history]
        minimum = min(masses)
        maximum = max(masses)
        span = max(maximum - minimum, 1.0)
        for fraction in (0.0, 0.5, 1.0):
            y = bottom - fraction * (bottom - top)
            value = minimum + fraction * span
            canvas.create_line(left, y, right, y, fill=COLORS["line"], dash=(2, 4))
            canvas.create_text(left - 7, y, text=f"{value:.0f}", anchor="e", fill=COLORS["muted"], font=("Segoe UI", 8))

        max_step = max(len(masses) - 1, 1)
        points: list[float] = []
        for step, mass in enumerate(masses):
            x = left + step / max_step * (right - left)
            y = bottom - (mass - minimum) / span * (bottom - top)
            points.extend((x, y))
        if len(points) >= 4:
            canvas.create_line(*points, fill=COLORS["blue"], width=2, smooth=True)

        current_x = left + min(self.current_step, max_step) / max_step * (right - left)
        canvas.create_line(current_x, top, current_x, bottom, fill=COLORS["blue"], dash=(4, 4))
        duration_min = float(self.history[-1].time_s) / 60.0
        canvas.create_text(left, height - 7, text="0 min", anchor="w", fill=COLORS["muted"], font=("Segoe UI", 8))
        canvas.create_text(right, height - 7, text=f"{duration_min:g} min", anchor="e", fill=COLORS["muted"], font=("Segoe UI", 8))
        canvas.create_text(8, top + 4, text="PCU", anchor="w", fill=COLORS["muted"], font=("Segoe UI", 8))

    def _save_dialog(self, extension: str, title: str) -> str:
        return filedialog.asksaveasfilename(
            parent=self,
            title=title,
            defaultextension=extension,
            filetypes=((f"{extension[1:].upper()} files", f"*{extension}"),),
            initialfile=f"flowline_demo{extension}",
        )

    def export_csv(self) -> None:
        if not self.history:
            return
        filename = self._save_dialog(".csv", "Save traffic results")
        if not filename:
            return
        try:
            with Path(filename).open("w", newline="", encoding="utf-8-sig") as output:
                writer = csv.writer(output)
                writer.writerow(("time_s", "cell", "start_m", "end_m", "density_vehicles_per_m", "speed_km_per_h", "flow_pcu_per_h", "inflow_demand_vehicles_per_s"))
                for state in self.history:
                    velocity, flow = traffic_sim._flow_from_density(state.density_vehicles_per_m, state.config)
                    for cell, density in enumerate(state.density_vehicles_per_m):
                        writer.writerow((
                            float(state.time_s),
                            cell + 1,
                            float(state.cell_edges_m[cell]),
                            float(state.cell_edges_m[cell + 1]),
                            float(density),
                            float(velocity[cell] * 3.6),
                            float(flow[cell] * 3600),
                            float(state.inflow_demand_vehicles_per_s or 0),
                        ))
            messagebox.showinfo(APP_TITLE, "Your results are saved as a CSV file.", parent=self)
        except OSError as error:
            messagebox.showerror(APP_TITLE, f"Could not save the CSV file.\n\n{error}", parent=self)

    def export_json(self) -> None:
        if not self.history:
            return
        filename = self._save_dialog(".json", "Save full simulation")
        if not filename:
            return
        payload = {
            "format": "flowline-simulation/v1",
            "scenario": (
                "Variable inflow around a mean with a capacity restriction"
                if self.run_inflow_variability_percent
                else "Constant inflow with a capacity restriction"
            ),
            "configuration": {
                "road_length_m": self.run_config.road_length_m,
                "cell_size_m": self.run_config.cell_size_m,
                "initial_density_vehicles_per_m": self.run_config.initial_density_vehicles_per_m,
                "free_flow_speed_m_per_s": self.run_config.free_flow_speed_m_per_s,
                "jam_density_vehicles_per_m": self.run_config.jam_density_vehicles_per_m,
                "inflow_demand_pcu_per_hour": self.run_config.inflow_demand_vehicles_per_s * 3600,
                "inflow_variability_percent": self.run_inflow_variability_percent,
                "inflow_random_seed": self.run_inflow_seed,
                "inflow_random_generator": "xorshift32",
                "inflow_resample_interval_s": 1.0,
                "bottleneck_position_m_requested": self.run_config.bottleneck_position_m,
                "bottleneck_position_m_on_grid": float(self.history[0].cell_edges_m[traffic_sim._bottleneck_index(self.run_config)]),
                "capacity_reduction_percent": self.run_config.lane_reduction * 100,
                "time_step_s": self.run_config.time_step_s,
                "duration_s": float(self.history[-1].time_s),
                "steps": len(self.history) - 1,
            },
            "frames": [
                {
                    "step": step,
                    "time_s": float(state.time_s),
                    "inflow_demand_vehicles_per_s": float(state.inflow_demand_vehicles_per_s or 0),
                    "cumulative_inflow_pcu": float(state.cumulative_inflow_vehicles),
                    "density_vehicles_per_m": [float(value) for value in state.density_vehicles_per_m],
                }
                for step, state in enumerate(self.history)
            ],
        }
        try:
            Path(filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")
            messagebox.showinfo(APP_TITLE, "Your full run and its settings are saved as JSON.", parent=self)
        except OSError as error:
            messagebox.showerror(APP_TITLE, f"Could not save the JSON file.\n\n{error}", parent=self)


def main() -> None:
    FlowlineApp().mainloop()


if __name__ == "__main__":
    main()
