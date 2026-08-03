import React from 'react';
import { Composition } from 'remotion';
import { Tour, totalFrames } from './Tour.jsx';
import { Promo, promoFrames } from './Promo.jsx';
import { Promo2, promo2Frames } from './Promo2.jsx';
import { Presenter, presenterFrames } from './Presenter.jsx';
import { ReplayTour, replayTourFrames } from './ReplayTour.jsx';
import { FleetFlow, fleetFlowFrames } from './FleetFlow.jsx';
import { FleetTour, fleetTourFrames } from './FleetTour.jsx';
import { Walkthrough, walkthroughFrames } from './Walkthrough.jsx';
import { Onboarding, onboardingFrames } from './Onboarding.jsx';
import { PresenterHost, presenterHostFrames } from './PresenterHost.jsx';
import manifest from './manifest.json';

export const Root = () => (
	<>
		<Composition
			id="Tour"
			component={Tour}
			durationInFrames={totalFrames}
			fps={manifest.fps}
			width={manifest.width}
			height={manifest.height}
		/>
		<Composition
			id="Promo"
			component={Promo}
			durationInFrames={promoFrames}
			fps={manifest.fps}
			width={manifest.width}
			height={manifest.height}
		/>
		<Composition
			id="Promo2"
			component={Promo2}
			durationInFrames={promo2Frames}
			fps={manifest.fps}
			width={manifest.width}
			height={manifest.height}
		/>
		<Composition
			id="Presenter"
			component={Presenter}
			durationInFrames={presenterFrames}
			fps={manifest.fps}
			width={manifest.width}
			height={manifest.height}
		/>
		<Composition
			id="ReplayTour"
			component={ReplayTour}
			durationInFrames={replayTourFrames}
			fps={manifest.fps}
			width={manifest.width}
			height={manifest.height}
		/>
		<Composition
			id="FleetFlow"
			component={FleetFlow}
			durationInFrames={fleetFlowFrames}
			fps={manifest.fps}
			width={1920}
			height={800}
		/>
		<Composition
			id="FleetTour"
			component={FleetTour}
			durationInFrames={fleetTourFrames}
			fps={manifest.fps}
			width={1920}
			height={1080}
		/>
		<Composition
			id="Walkthrough"
			component={Walkthrough}
			durationInFrames={walkthroughFrames}
			fps={manifest.fps}
			width={1920}
			height={1080}
		/>
		<Composition
			id="Onboarding"
			component={Onboarding}
			durationInFrames={onboardingFrames}
			fps={manifest.fps}
			width={1920}
			height={1080}
		/>
		<Composition
			id="PresenterHost"
			component={PresenterHost}
			durationInFrames={presenterHostFrames}
			fps={manifest.fps}
			width={1920}
			height={1080}
		/>
	</>
);
