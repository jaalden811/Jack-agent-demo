# Cisco Portfolio Pain-Point → Solution Mapping Report

**As of:** 2026-07-12  
**Purpose:** Convert unstructured customer language into a defensible pain category, Cisco/Splunk solution family, confidence score, rationale, and specialist route.

## Executive summary

This report converts Cisco's broad public portfolio into an agent-ready taxonomy. It deliberately maps to **solution families and buying motions**, not every appliance, license tier, hardware model, feature, compatibility rule, or ordering SKU. That is the correct abstraction for transcript classification: the agent first identifies the business and technical problem, then selects the relevant solution family, and only later invokes configuration, sizing, licensing, or specialist workflows.

The dictionary contains **34 pain categories** across networking, security, observability, data center, AI infrastructure, industrial IoT, service provider, collaboration, workplace, and lifecycle services.

The most important implementation rule is:

> A keyword match creates a candidate. It does not create a notification.

A notification should require either strong semantic evidence or an independent corroborating signal such as install base, an active opportunity, renewal timing, an incident, a stated project, or a quantified business impact.

## Scope and portfolio model

Cisco's public portfolio is best represented as seven operating domains:

1. **Networking and assurance:** campus, branch, WAN, wireless, internet/SaaS assurance, cloud-managed operations, smart spaces.
2. **Data center and AI infrastructure:** Nexus, ACI, Nexus Dashboard, UCS, Intersight, storage networking, AI PODs, Secure AI Factory.
3. **Security:** XDR, Splunk security analytics, firewalls, SSE/SASE, identity, endpoint, NDR, cloud/workload security, AI security, and OT security.
4. **Observability:** Splunk Observability Cloud, Splunk AppDynamics, Splunk ITSI, ThousandEyes, and the developer-oriented Cisco Observability Platform.
5. **Industrial and service provider:** rugged industrial networking, OT operations/security, mass-scale routing, automation, and routed optical networking.
6. **Collaboration and workplace:** Webex Suite, Calling, Contact Center, collaboration devices, Control Hub, and Spaces.
7. **Services:** planning, migration, adoption, optimization, support, and AI-assisted lifecycle experience.

## Corrections to the seed mapping

The user's seed was directionally strong, but several product roles should be tightened:

- **“Cisco Cloud” is too ambiguous.** Use the precise management plane: Cisco Networking Platform/Cloud Control for cross-domain network operations, Nexus Dashboard for data-center network operations, Intersight for compute lifecycle, or Security Cloud Control for security administration.
- **Nexus Dashboard and Intersight are not interchangeable.** Nexus Dashboard operates data-center network fabrics; Intersight manages UCS compute and infrastructure lifecycle.
- **Hypershield and Panoptica are security products, not generic multicloud orchestrators.** Hypershield is distributed security enforcement; Panoptica addresses cloud-native application/API/posture/runtime risk.
- **ThousandEyes is assurance, not code-level APM.** It is strongest when the fault may be in the internet, SaaS, DNS, BGP, ISP, cloud, or user path.
- **Splunk Observability Cloud and Splunk AppDynamics need separate cues.** Observability Cloud is the strongest default for OpenTelemetry-native cloud-native environments; AppDynamics remains a fit for hybrid and on-premises enterprise applications and business transactions.
- **Splunk ITSI is the manager-of-managers/service-health motion.** It correlates operational data and events to business-service impact; it should not be collapsed into general APM.
- **Cisco XDR and Splunk Enterprise Security overlap but are not synonyms.** XDR emphasizes curated cross-domain correlation and response; Splunk ES emphasizes broad SIEM data flexibility, custom detection, SOAR/UEBA, compliance, and SOC platform consolidation.
- **Umbrella should be modeled with migration context.** DNS-layer protection remains a valid cue, while broader SSE outcomes should map to Cisco Secure Access.
- **Cisco Observability Platform is a developer/extensibility mapping.** It should not be the default recommendation for a customer merely asking for standard observability.

## Portfolio map

| Entry ID | Domain | Pain category | Primary solution family |
|---|---|---|---|
| `cross_domain_network_operations` | Networking | Fragmented network operations and management | Cisco Networking Platform / Cisco Cloud Control; Cisco Catalyst Center; Cisco Meraki Dashboard |
| `campus_network_assurance` | Networking | Campus network assurance, automation, and troubleshooting | Cisco Catalyst Center; Cisco Catalyst 9000 switching; Cisco Wireless |
| `internet_saas_assurance` | Networking | Internet, SaaS, cloud, and external dependency visibility | Cisco ThousandEyes Assurance |
| `cloud_managed_network` | Networking | Cloud-managed distributed network simplification | Cisco Meraki Dashboard; Meraki MX; Meraki switching and wireless |
| `enterprise_sdwan` | Networking | Enterprise WAN modernization and application-aware connectivity | Cisco Catalyst SD-WAN; Meraki SD-WAN |
| `wireless_refresh` | Networking | Wireless capacity, coverage, reliability, and lifecycle refresh | Cisco Wireless Wi-Fi 7 access points; Cisco Catalyst Center or Meraki Dashboard |
| `smart_spaces` | Networking / Workplace | Location analytics, occupancy, asset visibility, and smart buildings | Cisco Spaces |
| `data_center_networking` | Data Center | Data-center fabric modernization, automation, and operations | Cisco Nexus Dashboard; Cisco Nexus 9000; Cisco ACI |
| `hybrid_compute_operations` | Data Center | Compute infrastructure lifecycle and hybrid operations | Cisco Intersight; Cisco UCS |
| `ai_infrastructure` | AI Infrastructure | Production AI infrastructure, GPU scale, and secure AI factory | Cisco Secure AI Factory with NVIDIA; Cisco AI PODs; Cisco UCS and Nexus |
| `storage_networking` | Data Center | Storage-area-network modernization and resilience | Cisco MDS 9000 Series; Nexus Dashboard SAN management capabilities |
| `industrial_connectivity` | Industrial IoT | Industrial connectivity, resilience, and OT network operations | Cisco Industrial Ethernet switches; Cisco industrial routers and wireless; Cisco IoT Operations Dashboard |
| `service_provider_modernization` | Service Provider | Mass-scale routing, metro/core modernization, and IP-optical convergence | Cisco 8000 Series Routers; Cisco Silicon One and IOS XR; Cisco Crosswork |
| `soc_detection_response` | Security | SOC alert overload, threat detection, investigation, and response | Cisco XDR; Splunk Enterprise Security |
| `siem_compliance` | Security / Data | Enterprise security analytics, SIEM, audit, and log-data platform | Splunk Enterprise Security; Splunk Cloud Platform; Splunk Enterprise |
| `firewall_policy` | Security | Firewall modernization, segmentation, and distributed policy management | Cisco Secure Firewall; Cisco Security Cloud Control |
| `identity_zero_trust` | Security | Identity security, MFA, device trust, and network access control | Cisco Duo; Cisco Identity Services Engine |
| `sase_remote_access` | Security / Networking | SSE, SASE, remote access, and branch-to-cloud security | Cisco Secure Access; Cisco Catalyst SD-WAN; Meraki SD-WAN |
| `endpoint_security` | Security | Endpoint prevention, detection, and response | Cisco Secure Endpoint; Cisco XDR |
| `network_detection_response` | Security | Network detection, behavioral analytics, and east-west visibility | Cisco Secure Network Analytics; Cisco XDR; Splunk |
| `cloud_workload_app_security` | Security | Hybrid multicloud workload, cloud network, API, and cloud-native application security | Cisco Hypershield; Cisco Secure Workload; Cisco Multicloud Defense |
| `ai_security` | Security / AI | AI application, model, agent, and shadow-AI security | Cisco AI Defense; Cisco Secure Access |
| `ot_security` | Security / Industrial | OT asset visibility, industrial segmentation, and secure remote access | Cisco Cyber Vision; Cisco industrial networking |
| `phishing_email_dns` | Security | Phishing, malicious email, DNS, and web threats | Cisco Email Threat Defense; Cisco Secure Access DNS/Web capabilities; Cisco Umbrella DNS-layer security |
| `cloud_native_observability` | Observability | Cloud-native application and infrastructure observability | Splunk Observability Cloud |
| `hybrid_onprem_apm` | Observability | Hybrid and on-premises application performance linked to business impact | Splunk AppDynamics |
| `service_health_aiops` | Observability / IT Operations | AIOps, alert-noise reduction, service health, and business-impact visibility | Splunk IT Service Intelligence |
| `digital_experience` | Observability / Networking | End-user and digital experience across application and network layers | Splunk Real User Monitoring and Synthetic Monitoring; Cisco ThousandEyes Assurance; Splunk AppDynamics or Splunk APM |
| `extensible_observability` | Observability Platform | Custom observability solutions and telemetry extensibility | Cisco Observability Platform |
| `collaboration_productivity` | Collaboration | Meetings, messaging, events, and hybrid-work productivity | Webex Suite |
| `cloud_calling` | Collaboration | Enterprise calling and PBX modernization | Webex Calling; Cisco Unified Communications Manager |
| `contact_center` | Collaboration / Customer Experience | Contact-center modernization and customer experience | Webex Contact Center; Webex Contact Center Enterprise |
| `room_devices_management` | Collaboration / Workplace | Meeting-room devices, workspace readiness, and centralized administration | Cisco Collaboration Devices; Webex Control Hub |
| `lifecycle_services_support` | Services | Technology lifecycle, adoption, support, and operational readiness | Cisco Professional Services; Cisco Support; Cisco IQ |

## Matching architecture

### 1. Normalize and segment

- Lowercase a copy for literal matching, but preserve the original transcript for evidence.
- Split by speaker turn and sentence.
- Preserve a context window of one sentence before and after each candidate sentence.
- Resolve negation, ownership, timing, and hypotheticals before scoring.
- Keep product mentions separate from pain evidence. A customer mentioning “ThousandEyes” does not prove a ThousandEyes pain.

### 2. Keyword candidate pass

Use weighted phrases rather than a flat word count:

- Exact multiword pain phrases receive the highest weight.
- Product-neutral technical terms receive medium weight.
- Generic terms such as “visibility,” “cloud,” “security,” or “dashboard” receive low weight.
- Repeated use only adds value when it occurs in distinct transcript chunks.
- Cap the keyword component so repetition cannot dominate.

Recommended component weight: **20%** when corroborating data is available.

### 3. Semantic pass

Embed transcript chunks and each entry's semantic cues. For each category:

```text
semantic_score =
    0.70 × highest cue similarity
  + 0.30 × mean of the top three cue similarities
```

Starting thresholds:

- **0.66:** candidate
- **0.74:** strong
- **0.82:** very strong

These are initialization values, not universal truths. Calibrate them against labeled transcripts using the exact production embedding model.

### 4. Corroboration pass

Score independent evidence such as:

- Existing product install base
- Renewal or end-of-life event
- Open opportunity or stated project
- Recent outage, incident, audit, or executive mandate
- Architecture evidence such as Kubernetes, UCS, Catalyst, Meraki, Splunk, or industrial network footprint
- Quantified impact, deadline, site count, affected users, or revenue exposure

Recommended component weight: **25%**.

### 5. Specificity and buying intent

Reward:

- Named owner or buying role
- Timeline
- Budget or evaluation
- Quantified scope or impact
- Explicit request for a solution, workshop, assessment, migration, or demo
- Renewal, RFP, EOL, or deadline

Recommended component weight: **10%**.

### 6. Penalties and suppression

- Explicit negation: **−0.35**
- Hypothetical, training, or generic discussion: **−0.20**
- Wrong-domain or negative-cue conflict: **−0.25**
- Competitor/product mention with no customer pain: **−0.10**
- Resolved issue with no remaining gap: suppress or strongly penalize

### 7. Final confidence and gates

```text
confidence =
    0.20 × keyword_score
  + 0.45 × semantic_score
  + 0.25 × corroboration_score
  + 0.10 × specificity_intent_score
  − penalties
```

Labels:

- **HIGH_INTENT:** confidence ≥ 0.78, and semantic ≥ 0.74 or corroboration ≥ 0.70, with no unresolved negation.
- **REVIEW:** 0.62–0.779, or meaningful product/domain ambiguity remains.
- **NOISE:** below 0.62, keyword-only evidence, hypothetical discussion, or explicit negation.

In transcript-only mode, use a 35% keyword / 65% semantic blend, but cap the result at **REVIEW** unless the transcript itself includes explicit timing, ownership, impact, and buying behavior.

## Critical conflict-resolution rules

### Visibility is not one category

- Owned campus LAN/WLAN health, clients, provisioning → **Catalyst Center**
- Internet/SaaS/DNS/BGP/ISP path → **ThousandEyes**
- Cloud-native traces/metrics/logs/Kubernetes → **Splunk Observability Cloud**
- Hybrid/on-prem application transactions and code → **Splunk AppDynamics**
- Cross-tool service health and business impact → **Splunk ITSI**
- Network behavior for threat detection → **Secure Network Analytics**
- OT assets and industrial protocols → **Cyber Vision**

### “One pane of glass” is not one product

- Cross-domain network operations → **Cisco Networking Platform / Cloud Control**
- Campus operations → **Catalyst Center**
- Cloud-managed distributed network → **Meraki Dashboard**
- Data-center network fabric → **Nexus Dashboard**
- UCS compute lifecycle → **Intersight**
- Security administration → **Security Cloud Control**
- Webex and room devices → **Webex Control Hub**
- IT service health across tools → **Splunk ITSI**

### Security alert overload

- Curated correlation across Cisco and third-party security controls, faster response → **Cisco XDR**
- Broad enterprise SIEM, custom analytics, compliance, SOAR/UEBA, large-scale data → **Splunk Enterprise Security**
- Operational—not security—alert storms tied to service health → **Splunk ITSI**

### Hybrid/multicloud complexity

Do not map the phrase automatically. Identify the object being managed:

- Network fabrics → Nexus Dashboard/ACI
- Compute and UCS lifecycle → Intersight
- Cloud network security → Multicloud Defense
- Workload microsegmentation → Secure Workload
- Cloud-native apps/APIs/posture/runtime → Panoptica
- Distributed enforcement → Hypershield
- Application/infrastructure telemetry → Splunk Observability
- User/application secure access → Secure Access

## Recommended agent output

```json
{
  "account": "Example Corp",
  "pain_category": "internet_saas_assurance",
  "confidence": 0.86,
  "intent_label": "HIGH_INTENT",
  "matched_text": [
    "Users in Europe lose access to Salesforce and we cannot tell whether it is our ISP or the SaaS provider."
  ],
  "matched_keywords": ["isp", "saas"],
  "matched_semantic_cues": [
    {
      "cue": "isolate performance problems across networks the customer does not own",
      "similarity": 0.88
    }
  ],
  "corroboration": [
    {
      "signal": "Catalyst SD-WAN installed across 120 sites",
      "source": "install_base"
    },
    {
      "signal": "Open global network assurance opportunity",
      "source": "opportunity"
    }
  ],
  "recommended_solution": ["Cisco ThousandEyes Assurance"],
  "why_this_solution": "The customer cannot isolate an external ISP/SaaS fault domain. ThousandEyes is the assurance layer for internet, cloud, SaaS, DNS, and end-user paths.",
  "why_not_adjacent_solution": "Catalyst Center can assure the owned campus network but does not replace end-to-end internet and SaaS path visibility.",
  "recommended_specialist": "ThousandEyes / Assurance specialist",
  "next_best_action": "specialist_route"
}
```

## Sample classification cases

### HIGH_INTENT: data-center AI infrastructure

**Transcript:** “We have approval to stand up a production inference cluster this quarter. The team is evaluating NVIDIA GPUs, but networking, security, and observability are separate workstreams and nobody owns the full design.”

**Result:** `ai_infrastructure`  
**Primary mapping:** Cisco Secure AI Factory with NVIDIA / Cisco AI PODs  
**Why:** Explicit production timeline, GPU evaluation, and need for validated full-stack architecture.  
**Corroboration to seek:** UCS/Nexus footprint, GPU RFP, data-center power/cooling plan, AI governance.

### HIGH_INTENT: security operations

**Transcript:** “Our analysts have five consoles open and still miss the incidents that matter. The SIEM renews in November, and leadership wants a consolidation plan before then.”

**Result:** `soc_detection_response` plus `siem_compliance`  
**Primary mapping:** Splunk Enterprise Security; evaluate Cisco XDR based on control footprint  
**Why:** Alert fatigue and consolidation are present, with a specific renewal date.  
**Disambiguation:** Broad SIEM renewal and data platform favor Splunk ES; Cisco-control correlation and rapid response strengthen XDR.

### REVIEW: vague visibility

**Transcript:** “We need better visibility across cloud.”

**Result:** Do not notify yet.  
**Why:** The object of visibility is unknown. It could mean network path, application telemetry, cloud security, workload policy, spend, or service health.  
**Next questions:** “Visibility into user experience, application performance, infrastructure, security risk, or cloud network policy?”

### NOISE: keyword-only

**Transcript:** “The presenter showed an XDR slide as an example, but we are not evaluating security tools this year.”

**Result:** `NOISE`  
**Why:** Product keyword appears, but explicit negation and hypothetical context suppress the match.

## Detailed mapping dictionary

## 1. Fragmented network operations and management

    **ID:** `cross_domain_network_operations`  
    **Domain:** Networking  
    **Recommended mapping:** Cisco Networking Platform / Cisco Cloud Control, with Catalyst Center, Meraki Dashboard, and ThousandEyes

    **Representative customer language**
    - We have too many network consoles.
- There is no unified operational view across campus, branch, and internet.
- We need one place to operate the network.
- Our teams waste time switching between Meraki, Catalyst, and other tools.

    **Keywords**
    `single pane`, `too many consoles`, `network operations`, `unified management`, `dashboard sprawl`, `cross-domain`, `agenticops`

    **Semantic meaning cues**
    - centralize day-to-day network operations across multiple domains
- reduce tool switching between campus, branch, cloud-managed, and internet assurance systems
- provide a common operational experience without replacing every underlying controller

    **Primary products and their roles**
    - **Cisco Networking Platform / Cisco Cloud Control** — Cross-domain cloud-native network operations layer
- **Cisco Catalyst Center** — Campus and enterprise network automation and assurance
- **Cisco Meraki Dashboard** — Cloud-managed networking operations
- **Cisco ThousandEyes Assurance** — Internet, SaaS, cloud, and end-user assurance

    **Choose this mapping when**
    - The problem spans multiple network domains or management systems.
- The buyer is network operations or infrastructure leadership.
- The customer wants operational unification rather than a hardware-only refresh.

    **Do not choose it when**
    - The problem is primarily SOC alert triage or security policy management.
- The customer only needs server lifecycle management.
- The issue is isolated to application code or database performance.

    **Corroboration**
    - Existing Catalyst, Meraki, or ThousandEyes footprint
- Multiple network-management products in install base
- NOC consolidation, tool-reduction, or network-operations transformation initiative

    **Likely buying roles:** VP Infrastructure, Head of Network Operations, NOC Director, Network Architect  
    **Intent markers:** platform consolidation project, operations transformation, renewal overlap, new NOC initiative  
    **Route to:** Enterprise Networking / Networking Platform specialist
## 2. Campus network assurance, automation, and troubleshooting

    **ID:** `campus_network_assurance`  
    **Domain:** Networking  
    **Recommended mapping:** Cisco Catalyst Center with Catalyst 9000 switching and Cisco Wireless

    **Representative customer language**
    - Users keep dropping off Wi-Fi and we cannot find the cause.
- Provisioning switches takes too long.
- We need better client health and network assurance.
- Campus changes are manual and inconsistent.

    **Keywords**
    `campus`, `client health`, `network health`, `assurance`, `provisioning`, `software image`, `configuration drift`, `sd-access`

    **Semantic meaning cues**
    - automate and assure an enterprise campus network
- troubleshoot wired and wireless client onboarding or performance
- standardize configurations and software lifecycle across Catalyst infrastructure

    **Primary products and their roles**
    - **Cisco Catalyst Center** — Campus automation, assurance, topology, client and application health
- **Cisco Catalyst 9000 switching** — Campus access, distribution, and core infrastructure
- **Cisco Wireless** — Enterprise wireless infrastructure

    **Choose this mapping when**
    - The fault domain is the owned campus LAN/WLAN.
- The customer needs provisioning, assurance, image management, or client troubleshooting.
- Catalyst is present or a campus refresh is planned.

    **Do not choose it when**
    - The dominant issue is outside the owned network.
- The customer explicitly wants a fully cloud-managed Meraki operating model.
- The problem is primarily user identity policy.

    **Corroboration**
    - Catalyst 9000 install base
- wireless controller/AP footprint
- campus refresh opportunity
- high help-desk volume for connectivity

    **Likely buying roles:** Campus Network Lead, Network Operations, Infrastructure Director  
    **Intent markers:** campus refresh, Wi-Fi refresh, automation mandate, image compliance project  
    **Route to:** Campus Networking specialist
## 3. Internet, SaaS, cloud, and external dependency visibility

    **ID:** `internet_saas_assurance`  
    **Domain:** Networking  
    **Recommended mapping:** Cisco ThousandEyes Assurance

    **Representative customer language**
    - The app is slow but our network looks fine.
- We cannot tell whether the ISP, SaaS provider, DNS, or cloud is responsible.
- We are blind once traffic leaves our network.
- Users in one region cannot reach a critical SaaS application.

    **Keywords**
    `internet`, `saas`, `isp`, `bgp`, `dns`, `packet loss`, `latency`, `path`, `external dependency`, `digital experience`

    **Semantic meaning cues**
    - isolate performance problems across networks the customer does not own
- see hop-by-hop internet and cloud paths
- correlate user experience with DNS, BGP, ISP, and SaaS dependencies

    **Primary products and their roles**
    - **Cisco ThousandEyes Assurance** — End-to-end assurance across internet, cloud, SaaS, networks, services, and users

    **Choose this mapping when**
    - The suspected fault can be outside the enterprise boundary.
- The customer cites ISP, DNS, BGP, SaaS, cloud region, or remote-user path issues.
- The goal is fault-domain isolation and experience assurance.

    **Do not choose it when**
    - The customer only needs application code instrumentation.
- The pain is security alert correlation.
- The issue is server provisioning or compute lifecycle.

    **Corroboration**
    - SaaS-heavy application portfolio
- global workforce
- multiple ISPs
- Catalyst SD-WAN or Meraki footprint
- SLA penalties

    **Likely buying roles:** Network Operations, Digital Experience Lead, SRE, Application Owner  
    **Intent markers:** recurring brownouts, SLA breach, major SaaS migration, global expansion  
    **Route to:** ThousandEyes / Assurance specialist
## 4. Cloud-managed distributed network simplification

    **ID:** `cloud_managed_network`  
    **Domain:** Networking  
    **Recommended mapping:** Cisco Meraki cloud-managed networking

    **Representative customer language**
    - We need to manage hundreds of branches with a small team.
- We want zero-touch deployment and one cloud dashboard.
- Our distributed sites are inconsistent.
- We need simpler networking for stores, clinics, or schools.

    **Keywords**
    `cloud managed`, `zero touch`, `distributed sites`, `branch`, `store`, `clinic`, `dashboard`, `lean IT`, `meraki`

    **Semantic meaning cues**
    - operate many distributed sites with limited local IT
- standardize branch networking from a cloud dashboard
- simplify deployment of switching, wireless, security, and SD-WAN

    **Primary products and their roles**
    - **Cisco Meraki Dashboard** — Cloud management and operational visibility
- **Meraki MX** — Cloud-managed security and SD-WAN
- **Meraki switching and wireless** — Cloud-managed LAN and WLAN

    **Choose this mapping when**
    - The customer values operational simplicity and rapid distributed deployment.
- Sites have limited or no local network staff.
- A common cloud-managed operating model is a priority.

    **Do not choose it when**
    - The customer requires a primarily on-premises controller model.
- The environment is a service-provider core.
- The principal problem is application telemetry.

    **Corroboration**
    - Large branch/store/site count
- Meraki install base
- managed service model
- rapid acquisition or expansion

    **Likely buying roles:** IT Director, Distributed Infrastructure Lead, Retail/Branch Technology Lead  
    **Intent markers:** new site rollout, branch standardization, M&A integration, lean-IT mandate  
    **Route to:** Meraki specialist
## 5. Enterprise WAN modernization and application-aware connectivity

    **ID:** `enterprise_sdwan`  
    **Domain:** Networking  
    **Recommended mapping:** Cisco Catalyst SD-WAN; Meraki SD-WAN for cloud-managed distributed environments

    **Representative customer language**
    - Our MPLS costs are too high.
- We need a more resilient WAN across branches and clouds.
- Traffic should take the best path automatically.
- We are planning an SD-WAN refresh.

    **Keywords**
    `sd-wan`, `mpls`, `wan`, `branch connectivity`, `path selection`, `direct internet access`, `multicloud connectivity`, `viptela`

    **Semantic meaning cues**
    - modernize enterprise WAN connectivity across branches, data centers, and cloud
- use application-aware routing and multiple transports
- build the networking foundation for SASE

    **Primary products and their roles**
    - **Cisco Catalyst SD-WAN** — Enterprise SD-WAN with multicloud connectivity, security, and predictive intelligence
- **Meraki SD-WAN** — Cloud-managed SD-WAN for distributed sites

    **Choose this mapping when**
    - WAN transport, branch-to-cloud connectivity, or application path selection is central.
- The customer is replacing MPLS or legacy routers.
- The customer is building toward SASE.

    **Do not choose it when**
    - The need is only user-to-SaaS security without WAN transformation.
- The buyer is discussing carrier backbone capacity.
- The issue is application code performance.

    **Corroboration**
    - ISR/ASR or Viptela footprint
- MPLS contracts
- branch router refresh
- cloud migration

    **Likely buying roles:** WAN Architect, Network Director, Infrastructure VP  
    **Intent markers:** MPLS renewal, router EOL, cloud migration, SASE roadmap  
    **Route to:** SD-WAN / Routing specialist
## 6. Wireless capacity, coverage, reliability, and lifecycle refresh

    **ID:** `wireless_refresh`  
    **Domain:** Networking  
    **Recommended mapping:** Cisco Wireless Wi-Fi 7 access points with Catalyst or Meraki management

    **Representative customer language**
    - Our Wi-Fi cannot handle device density.
- We have dead zones and roaming problems.
- We need Wi-Fi 7.
- Our access points are aging or out of support.

    **Keywords**
    `wi-fi 7`, `wireless`, `access point`, `coverage`, `density`, `roaming`, `6 ghz`, `refresh`, `dead zone`

    **Semantic meaning cues**
    - increase wireless capacity and reliability for dense or AI-enabled workplaces
- refresh aging access points and controllers
- improve coverage, roaming, and user experience

    **Primary products and their roles**
    - **Cisco Wireless Wi-Fi 7 access points** — Modern enterprise WLAN infrastructure
- **Cisco Catalyst Center or Meraki Dashboard** — On-premises or cloud management and assurance

    **Choose this mapping when**
    - The customer names capacity, coverage, roaming, density, or AP lifecycle.
- A workplace, campus, venue, healthcare, retail, or education refresh is planned.

    **Do not choose it when**
    - The problem is primarily internet/SaaS reachability.
- The customer only needs location analytics without a wireless refresh.

    **Corroboration**
    - Aging AP/controller models
- Wi-Fi 6 or older estate
- new building
- density complaints
- device growth

    **Likely buying roles:** Wireless Architect, Campus Network Lead, Workplace Technology  
    **Intent markers:** new building, AP EOL, Wi-Fi 7 initiative, capacity complaints  
    **Route to:** Wireless specialist
## 7. Location analytics, occupancy, asset visibility, and smart buildings

    **ID:** `smart_spaces`  
    **Domain:** Networking / Workplace  
    **Recommended mapping:** Cisco Spaces

    **Representative customer language**
    - We do not know how our buildings are being used.
- We need occupancy and space-utilization data.
- We need to locate devices or assets indoors.
- We want the network to act like a sensor.

    **Keywords**
    `occupancy`, `location analytics`, `indoor location`, `asset tracking`, `space utilization`, `smart building`, `iot sensors`

    **Semantic meaning cues**
    - turn network and collaboration infrastructure into a source of building intelligence
- analyze presence, location, occupancy, or environmental context
- connect people, things, and spaces for operational decisions

    **Primary products and their roles**
    - **Cisco Spaces** — Cloud platform for location, occupancy, IoT, and smart-space intelligence

    **Choose this mapping when**
    - The use case is physical-space intelligence.
- The customer has Cisco wireless, switches, cameras, collaboration devices, or third-party sensors.

    **Do not choose it when**
    - The term visibility refers to network or security visibility.
- The customer only wants room-device administration.

    **Corroboration**
    - Cisco wireless footprint
- real-estate consolidation
- return-to-office program
- asset-tracking requirement

    **Likely buying roles:** Facilities, Corporate Real Estate, Workplace Technology, IoT Lead  
    **Intent markers:** office redesign, lease consolidation, smart-building initiative, asset-loss problem  
    **Route to:** Cisco Spaces / Smart Buildings specialist
## 8. Data-center fabric modernization, automation, and operations

    **ID:** `data_center_networking`  
    **Domain:** Data Center  
    **Recommended mapping:** Cisco Nexus Dashboard, Nexus 9000, and Cisco ACI

    **Representative customer language**
    - Our data-center network is hard to operate.
- We need policy-driven fabric and better segmentation.
- Provisioning and troubleshooting Nexus fabrics is too manual.
- We need consistent operations across data centers.

    **Keywords**
    `data center fabric`, `nexus`, `aci`, `apic`, `vxlan`, `evpn`, `fabric automation`, `nexus dashboard`, `segmentation`

    **Semantic meaning cues**
    - automate and operate data-center network fabrics
- apply policy-driven connectivity and segmentation
- manage Nexus infrastructure across sites from a central operations platform

    **Primary products and their roles**
    - **Cisco Nexus Dashboard** — Data-center network operations, automation, lifecycle, and analytics
- **Cisco Nexus 9000** — Data-center switching and AI networking fabric
- **Cisco ACI** — Policy-driven data-center fabric and segmentation

    **Choose this mapping when**
    - The problem is the data-center network fabric.
- The customer needs Nexus/ACI operations, automation, visibility, or segmentation.

    **Do not choose it when**
    - The customer is asking only for UCS server management.
- The issue is distributed branch networking.
- The issue is cloud-native application observability.

    **Corroboration**
    - Nexus or ACI footprint
- data-center refresh
- AI workload initiative
- fabric consolidation

    **Likely buying roles:** Data Center Network Architect, Infrastructure Director, Cloud Network Lead  
    **Intent markers:** fabric refresh, ACI expansion, AI cluster build, data-center consolidation  
    **Route to:** Data Center Networking specialist
## 9. Compute infrastructure lifecycle and hybrid operations

    **ID:** `hybrid_compute_operations`  
    **Domain:** Data Center  
    **Recommended mapping:** Cisco Intersight with Cisco UCS

    **Representative customer language**
    - We need one place to manage our UCS estate.
- Server provisioning and firmware compliance are manual.
- We need infrastructure lifecycle management from core to edge.
- Our compute operations are inconsistent.

    **Keywords**
    `ucs`, `server management`, `firmware`, `intersight`, `compute lifecycle`, `provisioning`, `infrastructure as code`

    **Semantic meaning cues**
    - centrally manage Cisco UCS compute infrastructure
- automate server, fabric, storage, and provisioning workflows
- simplify compute lifecycle from core to edge

    **Primary products and their roles**
    - **Cisco Intersight** — Unified intelligent management and lifecycle for Cisco UCS compute
- **Cisco UCS** — Enterprise compute infrastructure

    **Choose this mapping when**
    - The pain centers on servers, compute profiles, firmware, provisioning, or UCS lifecycle.
- The customer wants SaaS-delivered infrastructure management.

    **Do not choose it when**
    - The pain is primarily network-fabric configuration.
- The customer needs application telemetry rather than infrastructure management.

    **Corroboration**
    - UCS install base
- manual firmware process
- multiple server generations
- edge compute expansion

    **Likely buying roles:** Compute Lead, Data Center Operations, Infrastructure Platform Team  
    **Intent markers:** server refresh, firmware compliance issue, UCS expansion, automation project  
    **Route to:** Compute / Intersight specialist
## 10. Production AI infrastructure, GPU scale, and secure AI factory

    **ID:** `ai_infrastructure`  
    **Domain:** AI Infrastructure  
    **Recommended mapping:** Cisco Secure AI Factory with NVIDIA and Cisco AI PODs

    **Representative customer language**
    - We need to move AI from pilots into production.
- We need GPU infrastructure that can scale.
- We need a validated AI stack with security and observability.
- Power, cooling, networking, and operational complexity are slowing our AI program.

    **Keywords**
    `ai factory`, `gpu`, `training`, `inference`, `ai pod`, `nvidia`, `high density`, `ai networking`, `agentic ai infrastructure`

    **Semantic meaning cues**
    - deploy a modular, validated enterprise AI infrastructure stack
- combine accelerated compute, high-performance networking, security, and observability
- scale AI training, fine-tuning, inference, or distributed agents from core to edge

    **Primary products and their roles**
    - **Cisco Secure AI Factory with NVIDIA** — Full-stack secure AI infrastructure architecture
- **Cisco AI PODs** — Pre-validated modular building blocks for enterprise AI
- **Cisco UCS and Nexus** — Compute and AI networking foundation
- **Cisco AI Defense and Splunk Observability** — AI security and operational visibility

    **Choose this mapping when**
    - The customer is building or modernizing AI infrastructure.
- The need spans compute, network, security, observability, and validated design.

    **Do not choose it when**
    - The only issue is shadow AI or prompt security.
- The customer only needs model/application monitoring.

    **Corroboration**
    - GPU procurement
- AI center of excellence
- data-center power planning
- NVIDIA strategy
- AI pilot backlog

    **Likely buying roles:** CTO, AI Infrastructure Lead, Data Center Architect, Head of AI Platform  
    **Intent markers:** GPU RFP, AI factory program, production AI deadline, data-center expansion  
    **Route to:** AI Infrastructure / Data Center specialist
## 11. Storage-area-network modernization and resilience

    **ID:** `storage_networking`  
    **Domain:** Data Center  
    **Recommended mapping:** Cisco MDS 9000 storage networking

    **Representative customer language**
    - Our SAN is aging.
- Storage congestion is affecting critical applications.
- We need resilient Fibre Channel connectivity.
- We need to modernize mainframe or mission-critical storage networking.

    **Keywords**
    `san`, `fibre channel`, `ficon`, `storage network`, `mds`, `vsan`, `fcip`, `storage congestion`

    **Semantic meaning cues**
    - modernize high-availability storage networking
- improve SAN performance, resiliency, security, or extension
- operate mission-critical Fibre Channel or mainframe storage fabrics

    **Primary products and their roles**
    - **Cisco MDS 9000 Series** — High-performance, resilient, secure SAN switching and directors
- **Nexus Dashboard SAN management capabilities** — Unified SAN operations and insights

    **Choose this mapping when**
    - The customer explicitly references SAN, Fibre Channel, FICON, or storage fabric.
- Availability and storage-network performance are business-critical.

    **Do not choose it when**
    - The need is general Ethernet switching.
- The customer is discussing cloud object storage with no SAN component.

    **Corroboration**
    - Existing MDS or competing SAN estate
- mainframe refresh
- storage-array migration
- Fibre Channel growth

    **Likely buying roles:** Storage Architect, Data Center Infrastructure, Mainframe Operations  
    **Intent markers:** storage refresh, array migration, mainframe upgrade, SAN EOL  
    **Route to:** Storage Networking specialist
## 12. Industrial connectivity, resilience, and OT network operations

    **ID:** `industrial_connectivity`  
    **Domain:** Industrial IoT  
    **Recommended mapping:** Cisco Industrial Ethernet, industrial routers and wireless, with IoT Operations Dashboard

    **Representative customer language**
    - We need reliable connectivity in harsh environments.
- Factories and field assets are hard to connect and manage.
- We need secure remote access to industrial equipment.
- Our OT network cannot support automation or industrial AI.

    **Keywords**
    `industrial`, `ot`, `factory`, `rugged`, `industrial ethernet`, `industrial router`, `urwb`, `private 5g`, `field asset`

    **Semantic meaning cues**
    - connect and automate industrial operations in harsh or distributed environments
- provide resilient wired, wireless, or cellular connectivity for OT assets
- centrally provision and operate industrial edge routers and networks

    **Primary products and their roles**
    - **Cisco Industrial Ethernet switches** — Rugged industrial switching
- **Cisco industrial routers and wireless** — Industrial WAN, cellular, and mission-critical wireless connectivity
- **Cisco IoT Operations Dashboard** — Cloud provisioning and management for industrial edge

    **Choose this mapping when**
    - The environment is manufacturing, utilities, transportation, mining, ports, or field operations.
- Ruggedization, deterministic uptime, mobility, or remote assets are central.

    **Do not choose it when**
    - The pain is a conventional office branch.
- The need is exclusively OT threat detection without connectivity modernization.

    **Corroboration**
    - Industrial switch/router footprint
- plant modernization
- remote asset program
- IT/OT convergence

    **Likely buying roles:** OT Network Lead, Plant Engineering, Industrial IT, Operations Technology Director  
    **Intent markers:** plant expansion, automation project, private cellular project, equipment remote-access initiative  
    **Route to:** Industrial IoT specialist
## 13. Mass-scale routing, metro/core modernization, and IP-optical convergence

    **ID:** `service_provider_modernization`  
    **Domain:** Service Provider  
    **Recommended mapping:** Cisco 8000 Series, Silicon One, Crosswork, and Routed Optical Networking

    **Representative customer language**
    - We need more core capacity with less power.
- Our IP and optical layers are too complex.
- We need 400G or 800G scale.
- We need to automate a carrier-grade network.

    **Keywords**
    `service provider`, `core routing`, `metro`, `peering`, `400g`, `800g`, `silicon one`, `ios xr`, `routed optical`, `crosswork`

    **Semantic meaning cues**
    - scale a carrier, webscale, metro, or backbone network
- converge IP and optical layers
- increase routing density while reducing power and operational complexity

    **Primary products and their roles**
    - **Cisco 8000 Series Routers** — Mass-scale, high-performance routing
- **Cisco Silicon One and IOS XR** — Routing silicon and network operating system
- **Cisco Crosswork** — Service-provider automation and assurance
- **Cisco Routed Optical Networking** — IP-optical convergence with coherent pluggable optics

    **Choose this mapping when**
    - The buyer is a service provider, webscale operator, or very large backbone team.
- The need concerns core, peering, metro, DCI, or optical convergence.

    **Do not choose it when**
    - The use case is ordinary enterprise SD-WAN.
- The customer is refreshing campus access switches.

    **Corroboration**
    - Cisco 8000/NCS footprint
- 400G/800G roadmap
- IP-optical transformation
- capacity expansion

    **Likely buying roles:** Service Provider CTO, Core Network Architect, Transport Engineering  
    **Intent markers:** capacity forecast, optical refresh, peering expansion, power-reduction initiative  
    **Route to:** Service Provider / Mass-Scale Infrastructure specialist
## 14. SOC alert overload, threat detection, investigation, and response

    **ID:** `soc_detection_response`  
    **Domain:** Security  
    **Recommended mapping:** Cisco XDR and/or Splunk Enterprise Security

    **Representative customer language**
    - We have too many alerts to triage.
- Analysts jump between tools during every incident.
- We do not know which threats matter.
- Response is too manual and slow.

    **Keywords**
    `xdr`, `alert fatigue`, `incident response`, `triage`, `soc`, `threat detection`, `investigation`, `response`, `soar`

    **Semantic meaning cues**
    - correlate security telemetry into prioritized incidents
- reduce SOC tool switching and accelerate investigation and response
- automate threat detection, investigation, and remediation workflows

    **Primary products and their roles**
    - **Cisco XDR** — Curated cross-domain telemetry correlation and prioritized incident response
- **Splunk Enterprise Security** — Broad SIEM/TDIR platform with SOAR, UEBA, detection engineering, and data flexibility

    **Choose this mapping when**
    - Use Cisco XDR when the emphasis is fast correlation and response across endpoint, network, firewall, email, identity, and DNS.
- Use Splunk Enterprise Security when the emphasis is broad data onboarding, SIEM, custom detections, compliance, SOAR, and SOC platform consolidation.
- Use both when Cisco controls and enterprise-wide data analytics must be joined.

    **Do not choose it when**
    - The customer only needs a point firewall or MFA product.
- The issue is IT operations alert noise rather than security incidents.

    **Corroboration**
    - Existing Cisco security controls
- Splunk estate
- SOC staffing pressure
- MDR/MXDR interest
- breach or tabletop findings

    **Likely buying roles:** CISO, SOC Director, Head of Detection and Response, Security Operations  
    **Intent markers:** recent incident, SOC consolidation, SIEM renewal, MDR evaluation, staffing shortage  
    **Route to:** Security Operations / XDR / Splunk Security specialist
## 15. Enterprise security analytics, SIEM, audit, and log-data platform

    **ID:** `siem_compliance`  
    **Domain:** Security / Data  
    **Recommended mapping:** Splunk Enterprise Security on Splunk Cloud Platform or Splunk Enterprise

    **Representative customer language**
    - We need centralized logs for security and compliance.
- Our SIEM is expensive or hard to scale.
- Audit reporting takes too long.
- We need custom detections across all our data.

    **Keywords**
    `siem`, `logs`, `compliance`, `audit`, `retention`, `spl`, `security analytics`, `data platform`, `ueba`

    **Semantic meaning cues**
    - ingest, search, and analyze security data from many sources at scale
- support compliance reporting, threat hunting, and custom detections
- consolidate SIEM, SOAR, UEBA, and security analytics

    **Primary products and their roles**
    - **Splunk Enterprise Security** — SIEM and unified threat detection, investigation, and response
- **Splunk Cloud Platform** — Managed cloud data platform
- **Splunk Enterprise** — Customer-managed/on-premises data platform

    **Choose this mapping when**
    - The customer requires broad data flexibility, retention, search, custom analytics, and compliance.
- The buying motion is SIEM replacement or SOC data-platform modernization.

    **Do not choose it when**
    - The requirement is only simple Cisco-native telemetry correlation.
- The problem is IT service health rather than security analytics.

    **Corroboration**
    - Existing Splunk estate
- SIEM renewal
- audit findings
- data-volume growth
- SOC engineering team

    **Likely buying roles:** CISO, SIEM Platform Owner, Security Engineering, Compliance  
    **Intent markers:** SIEM RFP, renewal event, audit deadline, data-tier optimization  
    **Route to:** Splunk Security specialist
## 16. Firewall modernization, segmentation, and distributed policy management

    **ID:** `firewall_policy`  
    **Domain:** Security  
    **Recommended mapping:** Cisco Secure Firewall with Cisco Security Cloud Control

    **Representative customer language**
    - Our firewalls are aging.
- Policies are inconsistent across sites and clouds.
- We need better threat prevention at the edge.
- Firewall changes are slow and risky.

    **Keywords**
    `firewall`, `ngfw`, `ips`, `policy`, `segmentation`, `hybrid mesh firewall`, `firepower`, `asa`, `threat defense`

    **Semantic meaning cues**
    - replace or modernize network firewalls
- enforce consistent security policy across distributed environments
- improve threat inspection, segmentation, and firewall operations

    **Primary products and their roles**
    - **Cisco Secure Firewall** — Network firewall and threat prevention across branch, campus, data center, and cloud
- **Cisco Security Cloud Control** — Unified cloud-native security and firewall management

    **Choose this mapping when**
    - The customer explicitly references firewall refresh, policy, IPS, perimeter, or segmentation.
- Distributed firewall management is a major pain.

    **Do not choose it when**
    - The primary need is secure access for users to SaaS/private apps.
- The customer only needs workload microsegmentation with no firewall modernization.

    **Corroboration**
    - ASA/Firepower footprint
- competing firewall renewal
- policy audit
- data-center or branch refresh

    **Likely buying roles:** Network Security, Firewall Operations, CISO  
    **Intent markers:** firewall EOL, policy cleanup, breach finding, data-center refresh  
    **Route to:** Network Security / Firewall specialist
## 17. Identity security, MFA, device trust, and network access control

    **ID:** `identity_zero_trust`  
    **Domain:** Security  
    **Recommended mapping:** Cisco Duo and Cisco Identity Services Engine

    **Representative customer language**
    - Passwords are our weakest link.
- We need phishing-resistant MFA.
- We do not know what devices are connecting.
- Access policies are inconsistent for users and devices.

    **Keywords**
    `mfa`, `duo`, `identity`, `device trust`, `nac`, `ise`, `zero trust`, `authentication`, `authorization`, `posture`

    **Semantic meaning cues**
    - verify user and device trust before granting access
- deploy strong or phishing-resistant authentication
- discover and control devices connecting to the network

    **Primary products and their roles**
    - **Cisco Duo** — Identity security, MFA, access, and device trust
- **Cisco Identity Services Engine** — Network access control, device visibility, segmentation policy, and trust

    **Choose this mapping when**
    - Use Duo for workforce/application authentication and identity access.
- Use ISE for network access control, device profiling, and segmentation policy.
- Use both for end-to-end user and device trust.

    **Do not choose it when**
    - The need is only firewall inspection.
- The problem is application performance.

    **Corroboration**
    - MFA gaps
- NAC replacement
- identity-related incident
- BYOD/IoT growth
- zero-trust program

    **Likely buying roles:** IAM Lead, Network Security, CISO, Zero Trust Program Lead  
    **Intent markers:** MFA mandate, cyber-insurance requirement, NAC refresh, zero-trust initiative  
    **Route to:** Identity / Zero Trust specialist
## 18. SSE, SASE, remote access, and branch-to-cloud security

    **ID:** `sase_remote_access`  
    **Domain:** Security / Networking  
    **Recommended mapping:** Cisco Secure Access with Catalyst SD-WAN or Meraki SD-WAN

    **Representative customer language**
    - Our VPN cannot scale.
- Remote users have inconsistent access and security.
- We need to secure access to SaaS and private applications.
- We are building a SASE architecture.

    **Keywords**
    `sase`, `sse`, `ztna`, `vpn`, `remote access`, `secure web gateway`, `casb`, `dns security`, `branch security`

    **Semantic meaning cues**
    - provide secure, identity-aware access for users, devices, applications, and agents anywhere
- replace or reduce legacy VPN dependence
- combine WAN transformation with cloud-delivered security

    **Primary products and their roles**
    - **Cisco Secure Access** — Cloud-delivered SSE including secure access to internet, SaaS, and private apps
- **Cisco Catalyst SD-WAN** — Enterprise WAN foundation for SASE
- **Meraki SD-WAN** — Cloud-managed branch foundation for SASE

    **Choose this mapping when**
    - The use case joins connectivity and cloud-delivered security.
- Remote users, branches, SaaS, private apps, or VPN replacement are central.

    **Do not choose it when**
    - The customer only needs a perimeter firewall refresh.
- The problem is internal application code.

    **Corroboration**
    - AnyConnect/VPN footprint
- Umbrella footprint
- SD-WAN project
- hybrid workforce
- SASE roadmap

    **Likely buying roles:** Network Security, WAN Team, CISO, End-User Computing  
    **Intent markers:** VPN replacement, SASE RFP, office consolidation, cloud migration  
    **Route to:** SASE / Secure Access specialist
## 19. Endpoint prevention, detection, and response

    **ID:** `endpoint_security`  
    **Domain:** Security  
    **Recommended mapping:** Cisco Secure Endpoint with Cisco XDR

    **Representative customer language**
    - We need better endpoint detection and response.
- Malware keeps getting through.
- We need threat hunting on endpoints.
- Our endpoint tools are disconnected from the SOC.

    **Keywords**
    `edr`, `endpoint`, `malware`, `ransomware`, `antivirus`, `threat hunting`, `secure endpoint`

    **Semantic meaning cues**
    - prevent, detect, investigate, and respond to threats on endpoints
- integrate endpoint telemetry into broader XDR workflows
- perform endpoint threat hunting and malware analysis

    **Primary products and their roles**
    - **Cisco Secure Endpoint** — Endpoint prevention, EDR, threat hunting, and malware protection
- **Cisco XDR** — Cross-domain investigation and response

    **Choose this mapping when**
    - Endpoints are the named control point.
- The customer wants EDR integrated with broader incident response.

    **Do not choose it when**
    - The problem is exclusively network flow analytics.
- The requirement is only MFA.

    **Corroboration**
    - Endpoint tool renewal
- ransomware event
- EDR coverage gaps
- XDR initiative

    **Likely buying roles:** Endpoint Security, SOC, CISO  
    **Intent markers:** EDR RFP, ransomware readiness, tool consolidation  
    **Route to:** Endpoint / XDR specialist
## 20. Network detection, behavioral analytics, and east-west visibility

    **ID:** `network_detection_response`  
    **Domain:** Security  
    **Recommended mapping:** Cisco Secure Network Analytics with Cisco XDR and Splunk integration

    **Representative customer language**
    - We cannot see lateral movement.
- We need to detect anomalous network behavior.
- We want to use network telemetry as a security sensor.
- Agents cannot be installed everywhere.

    **Keywords**
    `ndr`, `netflow`, `network behavior`, `lateral movement`, `anomaly`, `stealthwatch`, `flow analytics`, `east-west`

    **Semantic meaning cues**
    - detect threats by analyzing network behavior and flow telemetry
- gain agentless visibility across network and cloud traffic
- identify anomalous communications and lateral movement

    **Primary products and their roles**
    - **Cisco Secure Network Analytics** — Network visibility, behavioral analytics, and network threat detection
- **Cisco XDR** — Prioritized incident correlation and response
- **Splunk** — Broader analytics and data correlation

    **Choose this mapping when**
    - Network flow behavior is the primary signal.
- Agentless coverage or east-west visibility is required.

    **Do not choose it when**
    - The need is purely performance monitoring.
- The issue is endpoint malware prevention only.

    **Corroboration**
    - NetFlow-capable Cisco network
- Stealthwatch footprint
- lateral-movement concern
- regulated environment

    **Likely buying roles:** SOC, Network Security, Threat Detection Engineering  
    **Intent markers:** breach assessment, NDR evaluation, east-west visibility project  
    **Route to:** Network Detection and Response specialist
## 21. Hybrid multicloud workload, cloud network, API, and cloud-native application security

    **ID:** `cloud_workload_app_security`  
    **Domain:** Security  
    **Recommended mapping:** Cisco Hypershield, Secure Workload, Multicloud Defense, and Panoptica—selected by control point

    **Representative customer language**
    - Security policy is inconsistent across clouds.
- We need microsegmentation around workloads.
- We do not know our cloud-native application or API risk.
- We need protection that follows workloads across data centers and clouds.

    **Keywords**
    `multicloud security`, `microsegmentation`, `workload`, `cnapp`, `cspm`, `cwpp`, `api security`, `east-west`, `hypershield`, `panoptica`

    **Semantic meaning cues**
    - secure workloads and applications across hybrid and multicloud environments
- apply distributed segmentation and cloud network policy
- find and reduce cloud-native application, Kubernetes, API, posture, and runtime risk

    **Primary products and their roles**
    - **Cisco Hypershield** — Distributed security enforcement for applications, workloads, and infrastructure
- **Cisco Secure Workload** — Workload visibility and zero-trust microsegmentation
- **Cisco Multicloud Defense** — Cloud-native network security and consistent policy across clouds
- **Cisco Panoptica** — Cloud-native application and API security, including posture and workload protection

    **Choose this mapping when**
    - Use Secure Workload for workload dependency visibility and microsegmentation.
- Use Multicloud Defense for cloud network security and policy across VPCs/VNets.
- Use Panoptica for cloud-native application, Kubernetes, API, posture, and runtime security.
- Use Hypershield for distributed enforcement and segmentation across modern infrastructure.

    **Do not choose it when**
    - The customer is asking for cloud-resource orchestration rather than security.
- The issue is remote-user access.
- The issue is APM or infrastructure monitoring.

    **Corroboration**
    - AWS/Azure/GCP sprawl
- Kubernetes footprint
- microsegmentation initiative
- cloud security audit
- data-center modernization

    **Likely buying roles:** Cloud Security, Platform Security, CISO, Data Center Security  
    **Intent markers:** cloud migration, Kubernetes expansion, segmentation mandate, CNAPP RFP  
    **Route to:** Cloud and Workload Security specialist
## 22. AI application, model, agent, and shadow-AI security

    **ID:** `ai_security`  
    **Domain:** Security / AI  
    **Recommended mapping:** Cisco AI Defense, integrated with Cisco Secure Access and cloud controls

    **Representative customer language**
    - Employees are using unsanctioned AI tools.
- We need guardrails for our AI applications and agents.
- We do not know which models are safe.
- Prompt injection and data leakage are major concerns.

    **Keywords**
    `ai security`, `shadow ai`, `prompt injection`, `model validation`, `guardrails`, `llm`, `agent security`, `ai runtime`, `data leakage`

    **Semantic meaning cues**
    - discover and control enterprise use of AI applications
- validate AI models and applications before deployment
- protect AI runtime against prompt, model, agent, and data risks

    **Primary products and their roles**
    - **Cisco AI Defense** — AI inventory, validation, runtime protection, and policy for models, applications, and agents
- **Cisco Secure Access** — Control and protect workforce access to third-party AI applications

    **Choose this mapping when**
    - The risk is created by building, deploying, or using AI.
- The customer references shadow AI, model validation, runtime guardrails, or AI agents.

    **Do not choose it when**
    - The only issue is buying GPUs.
- The need is general cloud workload security with no AI-specific risk.

    **Corroboration**
    - AI development program
- GenAI acceptable-use policy
- model inventory gap
- AI governance initiative

    **Likely buying roles:** CISO, AI Governance, AI Platform Lead, Application Security  
    **Intent markers:** AI rollout, AI governance deadline, shadow-AI finding, model red-team requirement  
    **Route to:** AI Security specialist
## 23. OT asset visibility, industrial segmentation, and secure remote access

    **ID:** `ot_security`  
    **Domain:** Security / Industrial  
    **Recommended mapping:** Cisco Cyber Vision with industrial networking, ISE, firewall, and Splunk/XDR integration

    **Representative customer language**
    - We do not know what is connected in our plants.
- We need to segment OT without disrupting production.
- Vendors need secure temporary access to equipment.
- We need to detect industrial protocol and controller changes.

    **Keywords**
    `ot security`, `asset inventory`, `industrial protocol`, `plc`, `scada`, `cyber vision`, `purdue`, `secure remote access`

    **Semantic meaning cues**
    - discover industrial assets and communications without disrupting operations
- assess OT risk and design segmentation
- provide least-privilege remote access to industrial equipment

    **Primary products and their roles**
    - **Cisco Cyber Vision** — OT visibility, asset intelligence, risk, segmentation guidance, and secure remote access
- **Cisco industrial networking** — Embedded sensor and enforcement foundation

    **Choose this mapping when**
    - The environment is operational technology.
- Safety, uptime, passive discovery, and industrial protocols matter.

    **Do not choose it when**
    - The environment is ordinary enterprise IT.
- The need is only rugged connectivity with no security use case.

    **Corroboration**
    - Industrial Cisco footprint
- NERC/CIP or other OT regulation
- vendor remote access
- unknown asset inventory

    **Likely buying roles:** OT Security, Plant Operations, CISO, Industrial Network Lead  
    **Intent markers:** OT assessment, regulatory deadline, plant segmentation, remote vendor-access project  
    **Route to:** Industrial Security / Cyber Vision specialist
## 24. Phishing, malicious email, DNS, and web threats

    **ID:** `phishing_email_dns`  
    **Domain:** Security  
    **Recommended mapping:** Cisco Email Threat Defense and Cisco Secure Access DNS/Web protection; Umbrella where applicable

    **Representative customer language**
    - Phishing is our biggest user risk.
- We need to stop malicious links before users click.
- We need DNS-layer protection.
- Email threats are bypassing our current controls.

    **Keywords**
    `phishing`, `email security`, `dns security`, `malicious url`, `business email compromise`, `umbrella`, `email threat defense`

    **Semantic meaning cues**
    - protect users from malicious email, links, domains, and web destinations
- block threats at the DNS or secure-web layer
- analyze and respond to sophisticated email threats

    **Primary products and their roles**
    - **Cisco Email Threat Defense** — Email threat detection and response
- **Cisco Secure Access DNS/Web capabilities** — DNS-layer and secure-web protection
- **Cisco Umbrella DNS-layer security** — DNS security for applicable existing and targeted deployments

    **Choose this mapping when**
    - The attack vector is email, URL, DNS, or web access.
- The customer cites phishing, BEC, malicious domains, or user web protection.

    **Do not choose it when**
    - The issue is primarily endpoint EDR.
- The requirement is general SIEM.

    **Corroboration**
    - Umbrella footprint
- phishing incident
- email-security renewal
- user-protection initiative

    **Likely buying roles:** Email Security, Security Operations, CISO  
    **Intent markers:** phishing campaign, BEC incident, email gateway renewal, DNS security mandate  
    **Route to:** User Protection specialist
## 25. Cloud-native application and infrastructure observability

    **ID:** `cloud_native_observability`  
    **Domain:** Observability  
    **Recommended mapping:** Splunk Observability Cloud

    **Representative customer language**
    - Our microservices are a black box.
- We cannot correlate metrics, traces, and logs.
- Kubernetes incidents take too long to resolve.
- We need real-time observability across cloud environments.

    **Keywords**
    `observability`, `opentelemetry`, `apm`, `traces`, `metrics`, `logs`, `kubernetes`, `microservices`, `rum`, `infrastructure monitoring`

    **Semantic meaning cues**
    - instrument and troubleshoot cloud-native applications and infrastructure
- correlate traces, metrics, logs, user experience, databases, and infrastructure
- reduce mean time to root cause in distributed systems

    **Primary products and their roles**
    - **Splunk Observability Cloud** — OpenTelemetry-native full-stack observability for cloud-native and hybrid environments

    **Choose this mapping when**
    - Cloud-native, Kubernetes, microservices, distributed tracing, RUM, synthetics, database or infrastructure monitoring are central.

    **Do not choose it when**
    - The only need is hop-by-hop internet path visibility.
- The estate is mainly traditional on-prem applications and the buyer prefers AppDynamics.

    **Corroboration**
    - Kubernetes/cloud footprint
- OpenTelemetry program
- SRE organization
- incident MTTR problem

    **Likely buying roles:** SRE, Platform Engineering, DevOps, Application Operations  
    **Intent markers:** observability consolidation, cloud migration, APM renewal, major incident review  
    **Route to:** Splunk Observability specialist
## 26. Hybrid and on-premises application performance linked to business impact

    **ID:** `hybrid_onprem_apm`  
    **Domain:** Observability  
    **Recommended mapping:** Splunk AppDynamics

    **Representative customer language**
    - We need code-level visibility into a critical application.
- Our ERP or Java/.NET application is slow.
- We need to connect application performance to business transactions.
- Our application estate is hybrid and not fully cloud-native.

    **Keywords**
    `appdynamics`, `apm`, `business transaction`, `java`, `.net`, `sap`, `hybrid app`, `on-prem app`, `code level`

    **Semantic meaning cues**
    - monitor and troubleshoot traditional, hybrid, or on-premises applications
- connect code-level application performance to business transactions
- find application bottlenecks in mature enterprise application estates

    **Primary products and their roles**
    - **Splunk AppDynamics** — Hybrid and on-prem application performance monitoring tied to business performance

    **Choose this mapping when**
    - The estate includes critical traditional, hybrid, or on-prem applications.
- Business transactions and code-level application diagnostics are central.

    **Do not choose it when**
    - The need is purely internet/SaaS path visibility.
- The customer is standardizing exclusively on OpenTelemetry-native cloud monitoring.

    **Corroboration**
    - Existing AppDynamics
- ERP/core application
- Java/.NET estate
- business transaction SLA

    **Likely buying roles:** Application Operations, APM Owner, SRE, Business Application Owner  
    **Intent markers:** APM renewal, critical app incident, ERP modernization, digital-experience complaint  
    **Route to:** Splunk AppDynamics specialist
## 27. AIOps, alert-noise reduction, service health, and business-impact visibility

    **ID:** `service_health_aiops`  
    **Domain:** Observability / IT Operations  
    **Recommended mapping:** Splunk IT Service Intelligence

    **Representative customer language**
    - We have thousands of infrastructure alerts but no service context.
- We need to know which technical issue is affecting revenue.
- The NOC cannot see dependencies across services.
- We need event correlation and probable root cause.

    **Keywords**
    `itsi`, `aiops`, `service health`, `event correlation`, `kpi`, `episode`, `business service`, `alert noise`, `root cause`

    **Semantic meaning cues**
    - connect technical telemetry to business-service health
- correlate and prioritize IT operations events
- show service dependencies, KPIs, business impact, and likely root cause

    **Primary products and their roles**
    - **Splunk IT Service Intelligence** — AIOps, service health, event intelligence, and business-impact correlation

    **Choose this mapping when**
    - The buyer needs a manager-of-managers operational view.
- Alert noise, service health, dependency mapping, and business impact are central.

    **Do not choose it when**
    - The alerts are cybersecurity incidents.
- The need is only application instrumentation.

    **Corroboration**
    - Many monitoring tools
- NOC transformation
- Splunk platform footprint
- service-level reporting problem

    **Likely buying roles:** IT Operations, NOC, Service Management, Infrastructure Operations  
    **Intent markers:** AIOps project, NOC consolidation, major incident program, tool-sprawl reduction  
    **Route to:** Splunk ITSI / AIOps specialist
## 28. End-user and digital experience across application and network layers

    **ID:** `digital_experience`  
    **Domain:** Observability / Networking  
    **Recommended mapping:** Splunk RUM/Synthetic Monitoring plus ThousandEyes; AppDynamics where hybrid application context is required

    **Representative customer language**
    - Customers say the site is slow, but backend metrics look healthy.
- We need to test critical user journeys before users complain.
- Remote employees have inconsistent application experience.
- We need to connect front-end experience to network and backend causes.

    **Keywords**
    `digital experience`, `rum`, `synthetic`, `user journey`, `frontend`, `core web vitals`, `remote user`, `sla`, `page load`

    **Semantic meaning cues**
    - measure real and synthetic user experience
- test websites, APIs, and business transactions proactively
- correlate front-end, backend, and network causes of poor experience

    **Primary products and their roles**
    - **Splunk Real User Monitoring and Synthetic Monitoring** — Front-end and proactive user-journey monitoring
- **Cisco ThousandEyes Assurance** — Network, internet, SaaS, DNS, and path assurance
- **Splunk AppDynamics or Splunk APM** — Backend application context

    **Choose this mapping when**
    - The business outcome is end-user experience and multiple fault domains are possible.
- User journeys, remote users, websites, APIs, SaaS, or frontend performance are discussed.

    **Do not choose it when**
    - The need is only a network hardware refresh.
- The issue is security threat detection.

    **Corroboration**
    - Digital revenue dependency
- remote workforce
- SLA/SLO program
- customer-experience complaints

    **Likely buying roles:** Digital Experience, SRE, Application Owner, Network Operations  
    **Intent markers:** revenue-impacting incident, website launch, SLA breach, remote-work complaints  
    **Route to:** Cross-domain Observability / ThousandEyes specialist
## 29. Custom observability solutions and telemetry extensibility

    **ID:** `extensible_observability`  
    **Domain:** Observability Platform  
    **Recommended mapping:** Cisco Observability Platform

    **Representative customer language**
    - We need to build a domain-specific observability solution.
- We want an OpenTelemetry-based extensible platform.
- Partners need to build custom modules on top of Cisco telemetry.
- Our use case does not fit an out-of-box observability product.

    **Keywords**
    `cisco observability platform`, `extension`, `custom observability`, `opentelemetry`, `melt`, `solution sdk`, `developer platform`

    **Semantic meaning cues**
    - build custom observability applications or extensions
- ingest and model metrics, events, logs, and traces on an extensible platform
- create partner or industry-specific observability solutions

    **Primary products and their roles**
    - **Cisco Observability Platform** — Developer platform for custom OpenTelemetry-based observability solutions

    **Choose this mapping when**
    - The explicit requirement is to build or extend an observability solution.
- The buyer is a developer, partner, platform team, or solution builder.

    **Do not choose it when**
    - The customer wants an immediately deployable standard APM or ITSI solution.
- The term platform is being used loosely for dashboard consolidation.

    **Corroboration**
    - Developer/partner motion
- custom industry telemetry
- OpenTelemetry architecture
- extension requirement

    **Likely buying roles:** Platform Engineering, Developers, Cisco Partner, Enterprise Architecture  
    **Intent markers:** custom solution build, SDK evaluation, partner-developed module  
    **Route to:** Observability Platform / Developer specialist
## 30. Meetings, messaging, events, and hybrid-work productivity

    **ID:** `collaboration_productivity`  
    **Domain:** Collaboration  
    **Recommended mapping:** Webex Suite

    **Representative customer language**
    - Meetings are fragmented across tools.
- Teams need a common collaboration experience.
- We want AI summaries, messaging, meetings, and events together.
- Hybrid work is inconsistent.

    **Keywords**
    `webex`, `meetings`, `messaging`, `hybrid work`, `events`, `collaboration`, `ai assistant`, `team collaboration`

    **Semantic meaning cues**
    - provide an integrated collaboration suite for meetings, messaging, events, and teamwork
- improve hybrid-work productivity and meeting experience
- standardize employee collaboration on an enterprise platform

    **Primary products and their roles**
    - **Webex Suite** — Integrated collaboration for meetings, messaging, events, and employee experience

    **Choose this mapping when**
    - Employee collaboration is the primary outcome.
- The customer wants suite consolidation and AI-enabled teamwork.

    **Do not choose it when**
    - The use case is contact-center transformation.
- The only requirement is telephony migration.

    **Corroboration**
    - Existing Webex or collaboration estate
- tool consolidation
- hybrid-work program
- Microsoft interoperability need

    **Likely buying roles:** Collaboration Lead, CIO, Workplace Technology, HR/Employee Experience  
    **Intent markers:** collaboration renewal, hybrid-work redesign, tool-consolidation initiative  
    **Route to:** Collaboration / Webex specialist
## 31. Enterprise calling and PBX modernization

    **ID:** `cloud_calling`  
    **Domain:** Collaboration  
    **Recommended mapping:** Webex Calling, with Cisco Unified Communications Manager for hybrid/on-premises needs

    **Representative customer language**
    - Our PBX is aging.
- We need cloud calling across locations.
- We want to migrate from on-prem voice at our own pace.
- Calling must integrate with Microsoft Teams or Webex.

    **Keywords**
    `calling`, `pbx`, `voip`, `ucm`, `webex calling`, `pstn`, `phone system`, `cloud voice`

    **Semantic meaning cues**
    - modernize enterprise telephony and calling
- migrate from on-premises call control to cloud calling
- provide enterprise-grade voice integrated with collaboration tools

    **Primary products and their roles**
    - **Webex Calling** — Cloud enterprise calling and PBX
- **Cisco Unified Communications Manager** — On-premises or hybrid call control

    **Choose this mapping when**
    - Telephony, PBX, PSTN, calling plans, or voice migration are central.

    **Do not choose it when**
    - The buyer is discussing customer-service routing and agents.
- The need is only meetings.

    **Corroboration**
    - CUCM install base
- PBX EOL
- site consolidation
- carrier contract renewal

    **Likely buying roles:** Voice/UC Lead, Collaboration Director, Telecom Manager  
    **Intent markers:** PBX refresh, carrier renewal, office move, cloud-calling RFP  
    **Route to:** Calling specialist
## 32. Contact-center modernization and customer experience

    **ID:** `contact_center`  
    **Domain:** Collaboration / Customer Experience  
    **Recommended mapping:** Webex Contact Center

    **Representative customer language**
    - Customers wait too long for support.
- Agents switch between too many systems.
- We need an omnichannel cloud contact center.
- We want AI-assisted customer service.

    **Keywords**
    `contact center`, `ccaas`, `agent`, `customer service`, `omnichannel`, `ivr`, `queue`, `workforce optimization`

    **Semantic meaning cues**
    - modernize customer-service routing, agent workflows, and channels
- move contact-center operations to a cloud platform
- use AI and analytics to improve customer and agent experience

    **Primary products and their roles**
    - **Webex Contact Center** — Cloud contact center and customer-experience platform
- **Webex Contact Center Enterprise** — Feature-rich cloud contact center for large enterprises

    **Choose this mapping when**
    - Agents, queues, IVR, omnichannel service, or customer experience are central.

    **Do not choose it when**
    - The use case is internal employee collaboration.
- The need is basic enterprise calling only.

    **Corroboration**
    - Existing Cisco contact center
- CCaaS evaluation
- customer-service KPI issues
- agent desktop fragmentation

    **Likely buying roles:** Customer Experience, Contact Center Operations, CIO, Customer Service  
    **Intent markers:** CCaaS RFP, contact-center EOL, agent-experience project, AI customer-service initiative  
    **Route to:** Contact Center specialist
## 33. Meeting-room devices, workspace readiness, and centralized administration

    **ID:** `room_devices_management`  
    **Domain:** Collaboration / Workplace  
    **Recommended mapping:** Cisco Collaboration Devices with Webex Control Hub

    **Representative customer language**
    - Conference-room devices are hard to manage.
- We do not know which rooms are ready or failing.
- We need consistent video and audio experiences.
- Remote troubleshooting of room systems is too difficult.

    **Keywords**
    `room devices`, `conference room`, `video device`, `control hub`, `roomos`, `workspace`, `device management`, `room readiness`

    **Semantic meaning cues**
    - deploy and centrally manage collaboration devices and workspaces
- remotely troubleshoot room systems and monitor readiness
- standardize meeting-room audio, video, and device experience

    **Primary products and their roles**
    - **Cisco Collaboration Devices** — Room, desk, board, camera, and peripheral portfolio
- **Webex Control Hub** — Centralized provisioning, administration, analytics, and troubleshooting

    **Choose this mapping when**
    - The pain is physical collaboration spaces or device operations.
- Room readiness, device health, deployment, or remote troubleshooting are central.

    **Do not choose it when**
    - The need is only occupancy analytics.
- The problem is contact-center operations.

    **Corroboration**
    - Cisco room-device footprint
- office redesign
- hybrid-work rollout
- device EOL

    **Likely buying roles:** AV/Collaboration Engineering, Workplace Technology, Facilities IT  
    **Intent markers:** room refresh, office opening, hybrid-work standardization, device-management consolidation  
    **Route to:** Collaboration Devices specialist
## 34. Technology lifecycle, adoption, support, and operational readiness

    **ID:** `lifecycle_services_support`  
    **Domain:** Services  
    **Recommended mapping:** Cisco Professional Services, Cisco Support, and Cisco IQ

    **Representative customer language**
    - We bought the technology but adoption is low.
- We need help planning and de-risking the transformation.
- We need proactive support and lifecycle insights.
- Our team lacks the expertise to deploy and operate this at scale.

    **Keywords**
    `professional services`, `support`, `adoption`, `lifecycle`, `tac`, `success`, `assessment`, `migration`, `managed services`, `cisco iq`

    **Semantic meaning cues**
    - plan, design, deploy, adopt, optimize, and support Cisco technology
- reduce transformation risk and accelerate time to value
- use proactive insights and expert guidance across the technology lifecycle

    **Primary products and their roles**
    - **Cisco Professional Services** — Planning, design, migration, deployment, and optimization expertise
- **Cisco Support** — Technical support, troubleshooting, and lifecycle assistance
- **Cisco IQ** — AI-powered digital support and lifecycle experience

    **Choose this mapping when**
    - Skills, adoption, migration risk, or operational readiness are blocking value.
- The customer requests help beyond product acquisition.

    **Do not choose it when**
    - The conversation contains no services, adoption, skills, or lifecycle signal.

    **Corroboration**
    - Complex transformation
- limited internal staff
- poor adoption
- multiple technologies
- high business criticality

    **Likely buying roles:** CIO, Program Lead, Operations Leadership, Procurement  
    **Intent markers:** migration deadline, deployment backlog, skills gap, support renewal  
    **Route to:** Cisco Customer Experience / Services specialist

## Implementation checklist

- Keep the dictionary in version-controlled JSON.
- Give SMEs edit access without requiring code changes.
- Add aliases and retired names only as detection aids; always output the current public product name.
- Store positive cues, negative cues, product roles, and “do not choose” rules.
- Evaluate at sentence/turn level, then aggregate to account/opportunity level.
- Support multi-label output.
- Log all evidence and model scores for auditability.
- Maintain a labeled transcript test set for every category.
- Test paraphrases, negation, hypotheticals, competitor mentions, and overlapping pains.
- Revalidate names and positioning quarterly because Cisco's platform and packaging language evolves.
- Route uncertain cases to specialists instead of creating false certainty.

## Public source catalog

The JSON artifact includes the same source catalog as machine-readable name/URL pairs.

- [Cisco Networking Platform](https://www.cisco.com/site/us/en/products/networking/networking-cloud/index.html)
- [Cisco Catalyst Center](https://www.cisco.com/site/us/en/products/networking/catalyst-center/index.html)
- [Cisco ThousandEyes Assurance](https://www.cisco.com/site/us/en/products/networking/software/internet-cloud-intelligence/index.html)
- [Cisco Catalyst SD-WAN](https://www.cisco.com/site/us/en/solutions/networking/sdwan/catalyst/index.html)
- [Cisco Meraki MX](https://www.cisco.com/site/us/en/products/networking/sdwan-routers/meraki-security-appliances/index.html)
- [Cisco Wireless](https://www.cisco.com/site/us/en/products/networking/wireless/access-points/index.html)
- [Cisco Spaces](https://spaces.cisco.com/)
- [Cisco Nexus Dashboard](https://www.cisco.com/site/us/en/products/networking/cloud-networking/nexus-platform/index.html)
- [Cisco Data Center Modernization](https://www.cisco.com/site/us/en/solutions/data-center/index.html)
- [Cisco Intersight](https://www.cisco.com/site/us/en/products/computing/hybrid-cloud-operations/intersight-platform/index.html)
- [Cisco Secure AI Factory with NVIDIA](https://www.cisco.com/site/us/en/solutions/artificial-intelligence/secure-ai-factory/index.html)
- [Cisco AI PODs](https://www.cisco.com/site/us/en/solutions/artificial-intelligence/infrastructure/ai-pods.html)
- [Cisco MDS](https://www.cisco.com/site/us/en/products/networking/cloud-networking-switches/storage-area-networking/index.html)
- [Cisco Industrial IoT](https://www.cisco.com/site/us/en/solutions/networking/industrial-iot/index.html)
- [Cisco 8000 Series](https://www.cisco.com/site/us/en/products/networking/sdwan-routers/8000-series/index.html)
- [Cisco Routed Optical Networking](https://www.cisco.com/site/us/en/solutions/routed-optical-networking/index.html)
- [Cisco XDR](https://www.cisco.com/c/en/us/products/collateral/security/xdr/xdr-ds.html)
- [Splunk Enterprise Security](https://www.splunk.com/en_us/products/enterprise-security.html)
- [Cisco Secure Firewall](https://www.cisco.com/site/us/en/products/security/firewalls/index.html)
- [Cisco Security Cloud Control](https://www.cisco.com/c/en/us/products/collateral/security/security-cloud/security-cloud-control-aag.html)
- [Cisco Duo](https://www.cisco.com/site/us/en/products/security/duo/index.html)
- [Cisco ISE](https://www.cisco.com/site/us/en/products/security/identity-services-engine/index.html)
- [Cisco Secure Access](https://www.cisco.com/site/us/en/products/security/secure-access/index.html)
- [Cisco Secure Endpoint](https://www.cisco.com/site/us/en/products/security/endpoint-security/secure-endpoint/index.html)
- [Cisco Secure Network Analytics](https://www.cisco.com/site/us/en/products/security/security-analytics/secure-network-analytics/index.html)
- [Cisco Security Cloud](https://www.cisco.com/site/us/en/products/security/security-cloud/index.html)
- [Cisco AI Defense](https://www.cisco.com/site/us/en/products/security/ai-defense/index.html)
- [Cisco Cyber Vision](https://www.cisco.com/site/us/en/products/security/industrial-security/cyber-vision/index.html)
- [Splunk Observability Cloud](https://www.splunk.com/en_us/products/observability-cloud.html)
- [Splunk AppDynamics](https://www.cisco.com/c/en/us/solutions/data-center/appdynamics-application-performance-monitoring.html)
- [Splunk IT Service Intelligence](https://www.splunk.com/en_us/products/it-service-intelligence.html)
- [Cisco Observability Platform](https://developer.cisco.com/docs/cisco-observability-platform/)
- [Webex Suite](https://www.cisco.com/c/en/us/products/conferencing/webex-support/index.html)
- [Webex Calling](https://www.cisco.com/c/en/us/products/unified-communications/webex-calling/index.html)
- [Webex Contact Center](https://www.cisco.com/c/en/us/products/contact-center/index.html)
- [Webex Control Hub](https://www.cisco.com/c/en/us/products/conferencing/webex-control-hub/index.html)
- [Cisco Professional Services](https://www.cisco.com/site/us/en/services/professional/index.html)
- [Cisco Services and Support](https://www.cisco.com/site/us/en/services/index.html)
